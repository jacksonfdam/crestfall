"""
Build the Crestfall characters in Blender from the JSON dumped by
scripts/blender/export-chars.ts.

Why a JSON hop instead of porting src/chars to Python: the first version of
this script re-implemented three's primitive stacks, which meant two sources
of truth for the same silhouettes. Now the exporter walks the rigs the game
actually builds and bakes vertices, normals and triangles per bone, so what
lands here is what the renderer draws — including three's shading, carried
across as custom split normals rather than guessed per-face smooth flags.

What gets built, per (character, faction):
  * an Armature whose bones mirror the rig's joint tree, each pointing at its
    child joint so the skeleton is usable in the viewport;
  * one skinned mesh, rigid weights of 1.0 per joint, faction materials;
  * the idle / guard / victory pose tables as constant-interpolation keyframes
    on frames 1 / 11 / 21 — they are stills, so they hold rather than blend;
  * the character's travel cycle from frame TRAVEL_START, interpolated, with
    the vertical bob on the armature object. That cycle is sampled out of
    src/render/locomotion.ts by the exporter rather than described here, so
    the gait in the viewport is the gait the game plays and a wing beat or a
    hoof fold cannot drift between the two.

Pose rotations are converted into bone-local space as B⁻¹ · R · B, where B is
the bone's rest orientation in armature space. That lets the armature keep
natural head→child bones while still reproducing the exact euler triples from
the pose tables (three's default 'XYZ' order, i.e. Rx · Ry · Rz).

Usage inside Blender:
    import sys; sys.argv = ['build_chars.py', '<path to chars.json>']
    exec(open('<path to this file>').read())
Falls back to ../../assets/blender/chars.json relative to this file.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0

# three (Y up, facing -Z) -> Blender (Z up, facing -Y).
CONVERT = Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")

ORDER = ("huscarl", "berserkr", "volva", "jotunn", "valkyrie", "jarl")
FACTIONS = ("ash", "ember")
POSE_FRAMES = (("idle", 1), ("guard", 11), ("victory", 21))
# The travel cycle is keyed after the stills, one Blender frame per sample.
TRAVEL_START = 41

# When a joint has several children, these read as the spine of the chain.
PREFERRED_CHILD = ("spine", "chest", "head", "mount", "hips")
MIN_BONE_LEN = 0.03


# ------------------------------------------------------------------ helpers

def _set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def action_fcurves(action):
    """Blender <4.4 keeps fcurves on the action; 4.4+ nests them in channelbags."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", ()):
                out.extend(bag.fcurves)
    return out


def three_rot(x, y, z):
    """three's default 'XYZ' euler order: Rx @ Ry @ Rz."""
    return (
        Matrix.Rotation(x, 4, "X")
        @ Matrix.Rotation(y, 4, "Y")
        @ Matrix.Rotation(z, 4, "Z")
    )


def get_material(faction, key, spec):
    name = "crestfall_%s_%s" % (faction, key)
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    col = spec["color"]
    _set_input(bsdf, ("Base Color",), (col[0], col[1], col[2], 1.0))
    _set_input(bsdf, ("Roughness",), spec["roughness"])
    _set_input(bsdf, ("Metallic",), spec["metalness"])

    emissive = spec["emissive"]
    strength = spec["emissiveIntensity"] if any(emissive) else 0.0
    if strength:
        _set_input(
            bsdf,
            ("Emission Color", "Emission"),
            (emissive[0], emissive[1], emissive[2], 1.0),
        )
        _set_input(bsdf, ("Emission Strength",), strength)

    # Render-only surface break-up: a faint noise ripple on roughness so large
    # flat stone and cloth do not read as plastic. Base colour, metalness and
    # emission stay exactly as src/chars/materials.ts sets them.
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.location = (-620, -220)
    noise.inputs["Scale"].default_value = 24.0 if key == "stone" else 60.0
    noise.inputs["Detail"].default_value = 3.0
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-420, -220)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.72
    spread = 0.14 if key in ("stone", "wood", "hide", "cloth") else 0.07
    lo = max(0.0, spec["roughness"] - spread)
    hi = min(1.0, spec["roughness"] + spread)
    ramp.color_ramp.elements[0].color = (lo, lo, lo, 1.0)
    ramp.color_ramp.elements[1].color = (hi, hi, hi, 1.0)
    tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    rough_socket = bsdf.inputs.get("Roughness")
    if rough_socket is not None:
        tree.links.new(ramp.outputs["Color"], rough_socket)

    mat.diffuse_color = (col[0], col[1], col[2], 1.0)
    mat.roughness = spec["roughness"]
    mat.metallic = spec["metalness"]
    return mat


# --------------------------------------------------------------------- rig

def bone_order(bones):
    """Parents before children; the exporter emits root last."""
    by_name = {b["name"]: b for b in bones}
    out = []
    seen = set()

    def visit(name):
        if name in seen:
            return
        parent = by_name[name]["parent"]
        if parent:
            visit(parent)
        seen.add(name)
        out.append(name)

    for b in bones:
        visit(b["name"])
    return out, by_name


def rest_positions(order, by_name):
    out = {}
    for name in order:
        info = by_name[name]
        pos = Vector(info["pos"])
        parent = info["parent"]
        out[name] = pos + (out[parent] if parent else Vector((0, 0, 0)))
    return out


def bone_axis(name, by_name, children, rest, part_centres, dirs):
    """Head→tail direction: child joint, else mesh mass, else parent."""
    kids = [k for k in children.get(name, ()) if Vector(by_name[k]["pos"]).length > 1e-4]
    if kids:
        pick = next((k for k in PREFERRED_CHILD if k in kids), None)
        if pick is None:
            pick = max(kids, key=lambda k: Vector(by_name[k]["pos"]).length)
        offset = rest[pick] - rest[name]
        return offset.normalized(), max(offset.length, MIN_BONE_LEN)

    centre = part_centres.get(name)
    if centre is not None and centre.length > 0.02:
        return centre.normalized(), min(max(centre.length, 0.04), 0.5)

    parent = by_name[name]["parent"]
    if parent and parent in dirs:
        return dirs[parent], 0.06
    return Vector((0, 1, 0)), 0.06


def realize(name, faction, char, palette, location, collection):
    order, by_name = bone_order(char["bones"])
    rest = rest_positions(order, by_name)
    children = {}
    for b in char["bones"]:
        if b["parent"]:
            children.setdefault(b["parent"], []).append(b["name"])

    # Mean vertex position per bone, for orienting leaf bones.
    centres = {}
    for part in char["parts"]:
        pos = part["positions"]
        n = len(pos) // 3
        if not n:
            continue
        acc = Vector((sum(pos[0::3]), sum(pos[1::3]), sum(pos[2::3]))) / n
        prev = centres.get(part["bone"])
        centres[part["bone"]] = acc if prev is None else (prev + acc) / 2

    coll = bpy.data.collections.new("%s_%s" % (name, faction))
    collection.children.link(coll)

    # ---- armature ----
    arm_data = bpy.data.armatures.new("%s_%s_rig" % (name, faction))
    arm_obj = bpy.data.objects.new("%s_%s_rig" % (name, faction), arm_data)
    coll.objects.link(arm_obj)
    arm_obj.matrix_world = Matrix.Translation(Vector(location)) @ CONVERT

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    dirs = {}
    edit_bones = {}
    for bname in order:
        axis, length = bone_axis(bname, by_name, children, rest, centres, dirs)
        dirs[bname] = axis
        eb = arm_data.edit_bones.new(bname)
        eb.head = rest[bname]
        eb.tail = rest[bname] + axis * length
        edit_bones[bname] = eb
    for bname in order:
        parent = by_name[bname]["parent"]
        if parent:
            edit_bones[bname].parent = edit_bones[parent]
            edit_bones[bname].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    # ---- skinned mesh ----
    verts = []
    faces = []
    loop_normals = []
    face_mats = []
    mats = []
    mat_index = {}
    groups = {}

    for part in char["parts"]:
        key = part["mats"][faction]
        if key not in mat_index:
            mat_index[key] = len(mats)
            mats.append(get_material(faction, key, palette[key]))
        midx = mat_index[key]

        offset = rest[part["bone"]]
        base = len(verts)
        pos = part["positions"]
        nor = part["normals"]
        count = len(pos) // 3
        for i in range(count):
            verts.append(
                (
                    pos[i * 3] + offset.x,
                    pos[i * 3 + 1] + offset.y,
                    pos[i * 3 + 2] + offset.z,
                )
            )
        groups.setdefault(part["bone"], []).extend(range(base, base + count))

        idx = part["indices"]
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t + 1], idx[t + 2]
            if a == b or b == c or a == c:
                continue  # degenerate ring triangle at a pole
            faces.append((base + a, base + b, base + c))
            face_mats.append(midx)
            for v in (a, b, c):
                loop_normals.append((nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]))

    mesh = bpy.data.meshes.new("%s_%s" % (name, faction))
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    for mat in mats:
        mesh.materials.append(mat)
    for poly, midx in zip(mesh.polygons, face_mats):
        poly.material_index = midx
        poly.use_smooth = True
    # Carry three's own vertex normals across, so a boxy part still reads
    # faceted and a lathe still reads round.
    if len(loop_normals) == len(mesh.loops):
        mesh.normals_split_custom_set(loop_normals)

    obj = bpy.data.objects.new("%s_%s" % (name, faction), mesh)
    coll.objects.link(obj)
    gidx = {}
    for bname in order:
        if bname in groups:
            gidx[bname] = len(gidx)
            obj.vertex_groups.new(name=bname)
    for bname, indices in groups.items():
        obj.vertex_groups[bname].add(indices, 1.0, "REPLACE")
    obj.parent = arm_obj
    obj.matrix_parent_inverse = Matrix.Identity(4)
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj

    # ---- poses and travel ----
    arm_obj.animation_data_create()
    action = bpy.data.actions.new("%s_%s_poses" % (name, faction))
    arm_obj.animation_data.action = action
    rest_basis = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}

    def write_table(table, frame):
        """Key every bone this table names, converted into bone-local space."""
        for bname in order:
            pb = arm_obj.pose.bones[bname]
            pb.rotation_mode = "QUATERNION"
            euler = table.get(bname)
            if euler is None:
                continue
            basis = rest_basis[bname]
            local = basis.inverted() @ three_rot(*euler).to_3x3() @ basis
            pb.rotation_quaternion = local.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=frame)

    for pose_name, frame in POSE_FRAMES:
        write_table(char["poses"][pose_name], frame)

    # The three canonical poses are stills, so they hold rather than blend.
    for fc in action_fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = "CONSTANT"

    # Travel cycle, sampled straight out of src/render/locomotion.ts so the
    # gait in the viewport is the gait the game plays. Keyed after the stills
    # and interpolated, because unlike them it is a continuous motion; the bob
    # rides on the armature object, which is where three applies it too.
    travel = char.get("travel")
    frames = travel.get("frames", []) if travel else []
    base = arm_obj.location.copy()
    for i, f in enumerate(frames):
        frame = TRAVEL_START + i
        write_table(f["bones"], frame)
        # three's +Y maps to Blender's +Z under CONVERT, so the bob is a Z lift.
        arm_obj.location = base + Vector((0.0, 0.0, f.get("bob", 0.0)))
        arm_obj.keyframe_insert("location", frame=frame)
    arm_obj.location = base

    for fc in action_fcurves(action):
        for kp in fc.keyframe_points:
            if kp.co.x >= TRAVEL_START:
                kp.interpolation = "LINEAR"
    if not action_fcurves(action):
        print("  warning: %s_%s produced no pose fcurves" % (name, faction))

    return arm_obj, obj, len(mesh.polygons)


# ------------------------------------------------------------------- scene

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.actions,
        bpy.data.materials,
        bpy.data.collections,
        bpy.data.lights,
        bpy.data.cameras,
    ):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area_light(name, energy, size, colour, location, target, root):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.size = size
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    root.objects.link(obj)
    look_at(obj, target)
    return obj


def build_scene(payload):
    clear_scene()
    scene = bpy.context.scene

    root = bpy.data.collections.new("crestfall")
    scene.collection.children.link(root)
    per_faction = {}
    for faction in FACTIONS:
        c = bpy.data.collections.new(faction)
        root.children.link(c)
        per_faction[faction] = c

    spacing = 1.4
    rows = {"ash": 0.0, "ember": 1.9}
    built = []
    for i, name in enumerate(ORDER):
        char = payload["characters"][name]
        for faction in FACTIONS:
            arm, obj, faces = realize(
                name,
                faction,
                char,
                payload["materials"][faction],
                (i * spacing, rows[faction], 0.0),
                per_faction[faction],
            )
            built.append((name, faction, arm, obj, len(char["bones"]), faces))

    # Ground: mid grey, so both factions keep their value separation.
    ground_mesh = bpy.data.meshes.new("ground")
    gb = bmesh.new()
    bmesh.ops.create_grid(gb, x_segments=1, y_segments=1, size=16.0)
    gb.to_mesh(ground_mesh)
    gb.free()
    ground_mat = bpy.data.materials.new("crestfall_ground")
    ground_mat.use_nodes = True
    bsdf = ground_mat.node_tree.nodes["Principled BSDF"]
    _set_input(bsdf, ("Base Color",), (0.032, 0.031, 0.03, 1.0))
    _set_input(bsdf, ("Roughness",), 0.92)
    ground_mesh.materials.append(ground_mat)
    ground = bpy.data.objects.new("ground", ground_mesh)
    ground.location = (3.5, 0.9, 0.0)
    root.objects.link(ground)

    # Three-point rig: cool key from the front left, warm bounce on the ember
    # side, tight rim from behind to cut both rows off the background.
    target = (3.5, 0.9, 0.8)
    area_light("key", 1650.0, 4.5, (0.88, 0.93, 1.0), (-2.6, -6.4, 6.0), target, root)
    area_light("fill", 460.0, 9.0, (1.0, 0.86, 0.7), (9.8, 2.4, 3.0), target, root)
    area_light("rim", 820.0, 5.0, (0.8, 0.87, 1.0), (3.5, 8.5, 4.6), target, root)

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.026, 0.028, 0.034, 1.0)
        bg.inputs[1].default_value = 0.32

    cam_data = bpy.data.cameras.new("camera")
    cam_data.lens = 40.0
    cam = bpy.data.objects.new("camera", cam_data)
    cam.location = (3.5, -9.1, 1.95)
    root.objects.link(cam)
    look_at(cam, (3.5, 0.95, 0.9))
    scene.camera = cam

    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    # The palette is tuned so ash and ember separate in greyscale (see
    # src/chars/materials.ts). A filmic transform compresses exactly that, so
    # render Standard and carry the contrast in the lighting instead.
    for transform in ("Standard", "Filmic", "AgX"):
        try:
            scene.view_settings.view_transform = transform
            break
        except Exception:
            continue
    if hasattr(scene.view_settings, "look"):
        try:
            scene.view_settings.look = "None"
        except Exception:
            pass
    for attr, value in (
        ("use_gtao", True),
        ("use_bloom", False),
        ("use_raytracing", True),
        ("taa_render_samples", 96),
    ):
        if hasattr(scene.eevee, attr):
            try:
                setattr(scene.eevee, attr, value)
            except Exception:
                pass

    scene.frame_start = 1
    travel_len = max(
        (len(payload["characters"][n].get("travel", {}).get("frames", [])) for n in ORDER),
        default=0,
    )
    scene.frame_end = TRAVEL_START + travel_len - 1 if travel_len else 21
    scene.frame_set(1)
    return built


def render_previews(out_dir):
    """Row shot per pose, plus a two-faction close-up per character."""
    scene = bpy.context.scene
    cam = bpy.data.objects["camera"]
    written = []

    def shoot(path, location, target, lens, res):
        cam.data.lens = lens
        cam.location = location
        look_at(cam, target)
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

    for pose, frame in POSE_FRAMES:
        scene.frame_set(frame)
        shoot(
            os.path.join(out_dir, "chars_%s.png" % pose),
            (3.5, -9.1, 1.95),
            (3.5, 0.95, 0.9),
            40.0,
            (1800, 700),
        )

    scene.frame_set(1)
    spacing = 1.4
    for i, name in enumerate(ORDER):
        x = i * spacing
        shoot(
            os.path.join(out_dir, "char_%s.png" % name),
            (x + 0.35, -2.6, 1.05),
            (x + 0.35, 0.95, 0.72),
            55.0,
            (1000, 1250),
        )
    scene.frame_set(1)
    return written


def main():
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "."
    default = os.path.normpath(
        os.path.join(here, "..", "..", "assets", "blender", "chars.json")
    )
    path = globals().get("CHARS_JSON") or default
    with open(path) as fh:
        payload = json.load(fh)

    built = build_scene(payload)
    print("crestfall: built %d rigs from %s" % (len(built), path))
    out_dir = globals().get("RENDER_TO")
    if out_dir:
        for shot in render_previews(out_dir):
            print("  rendered %s" % os.path.basename(shot))
    for name, faction, _arm, obj, nbones, faces in built:
        print(
            "  %-9s %-5s bones=%2d verts=%5d faces=%5d"
            % (name, faction, nbones, len(obj.data.vertices), faces)
        )
    return built


RESULT = main()
