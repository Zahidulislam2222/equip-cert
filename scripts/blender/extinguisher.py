"""Procedural fire extinguisher — the hero subject, built in code so it is reproducible.

Blender owns geometry and camera; nothing about the shape is left to a generative model.
See _shared-infrastructure/frontend-craft/FRONTEND-PLAYBOOK.md for why.

Modes
  beauty  Cycles still, film-transparent with a shadow catcher, for the hero/OG plate.
  clay    EEVEE grey white-model pass — the structure reference handed to a video model.
  flight  EEVEE frame sequence along the camera path (clay or beauty shading).

Usage
  blender -b --factory-startup --python scripts/blender/extinguisher.py -- \
      --mode beauty --out out.png --width 2000 --height 1500 --samples 160
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

# Brand accent, linear-ish RGB for the rim light. hsl(45 100% 55%) -> sRGB (255, 199, 26).
ACCENT = (1.0, 0.58, 0.02)


# --------------------------------------------------------------------------- helpers

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, base, metallic=0.0, roughness=0.5, coat=0.0, emission=None,
             rough_variation=0.0, bump=0.0, noise_scale=90.0):
    """Principled material, optionally broken up by procedural noise.

    A single flat roughness value is the clearest tell of an untouched CG surface: real
    objects have wear, dust and handling that scatter the highlight. `rough_variation`
    modulates roughness through a noise texture and `bump` adds micro-relief.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    def put(socket, value):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = value

    put("Base Color", (*base, 1.0))
    put("Metallic", metallic)
    put("Roughness", roughness)
    # Renamed in Blender 4.0; support both spellings rather than guessing the build.
    put("Coat Weight", coat)
    put("Clearcoat", coat)
    if emission:
        put("Emission Color", (*emission, 1.0))
        put("Emission Strength", 1.6)

    if rough_variation <= 0 and bump <= 0:
        return mat

    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = noise_scale
    tex.inputs["Detail"].default_value = 6.0
    tex.location = (-760, -140)

    if rough_variation > 0:
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.location = (-560, -80)
        lo = max(0.0, roughness - rough_variation)
        hi = min(1.0, roughness + rough_variation)
        ramp.color_ramp.elements[0].color = (lo, lo, lo, 1.0)
        ramp.color_ramp.elements[1].color = (hi, hi, hi, 1.0)
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])

    if bump > 0:
        bump_node = nt.nodes.new("ShaderNodeBump")
        bump_node.inputs["Strength"].default_value = bump
        bump_node.inputs["Distance"].default_value = 0.0015
        bump_node.location = (-380, -320)
        nt.links.new(tex.outputs["Fac"], bump_node.inputs["Height"])
        nt.links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])

    return mat


def shade_smooth(obj, angle_deg=35.0):
    """Smooth shading across three API generations.

    <=4.0 exposed `mesh.use_auto_smooth`; 4.1+ removed it and moved auto-smooth to an
    operator backed by a geometry-nodes asset, so there is no `SMOOTH_BY_ANGLE` modifier
    to add directly.
    """
    if obj.type != "MESH":
        return
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True

    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(angle_deg)
        return

    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except (AttributeError, RuntimeError):
        # Per-polygon smoothing above is already applied; sharp creases are preserved by
        # the bevel modifiers, so this degrades acceptably.
        pass


def orbit_position(feature, azimuth_deg, elevation_deg, distance):
    """Place the camera on a sphere around the part being inspected.

    Azimuth is measured in the XY plane from +X; elevation is above horizontal. Deriving the
    position from the feature guarantees the part is centred and correctly sized for the
    chosen lens, which hand-written coordinates repeatedly failed to do.
    """
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    horizontal = math.cos(el) * distance
    return Vector((
        feature.x + math.cos(az) * horizontal,
        feature.y + math.sin(az) * horizontal,
        feature.z + math.sin(el) * distance,
    ))


def iter_fcurves(action):
    """Yield an action's F-curves across Blender's two animation APIs.

    Blender 4.4 introduced slotted actions and 5.x removed `Action.fcurves` entirely; curves
    now live under layers -> strips -> channelbags. Older builds keep the flat list.
    """
    if hasattr(action, "fcurves"):
        for fcurve in action.fcurves:
            yield fcurve
        return
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                for fcurve in bag.fcurves:
                    yield fcurve


def bevel(obj, width, segments=4):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)


# --------------------------------------------------------------------------- geometry

def build_extinguisher():
    """A 5 kg CO2-style body: cylinder, domed shoulder, valve head, lever, gauge, hose."""
    parts = []

    red = material("Body Red", (0.115, 0.0105, 0.0075), roughness=0.25, coat=0.55,
                    rough_variation=0.040, bump=0.045, noise_scale=190)
    steel = material("Steel", (0.56, 0.56, 0.585), metallic=1.0, roughness=0.28,
                     rough_variation=0.055, bump=0.07, noise_scale=260)
    brass = material("Brass", (0.68, 0.49, 0.18), metallic=1.0, roughness=0.26,
                     rough_variation=0.060, bump=0.08, noise_scale=240)
    rubber = material("Rubber", (0.035, 0.035, 0.038), roughness=0.82,
                      rough_variation=0.05, bump=0.18, noise_scale=300)
    face = material("Gauge Face", (0.86, 0.86, 0.84), roughness=0.18)
    label = material("Label", (0.030, 0.028, 0.025), roughness=0.55, rough_variation=0.05,
                     bump=0.03, noise_scale=300)

    # --- body -------------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.118, depth=0.42, location=(0, 0, 0.29))
    body = bpy.context.object
    body.name = "Body"
    body.data.materials.append(red)
    bevel(body, 0.030, 8)
    shade_smooth(body)
    parts.append(body)

    # --- domed shoulder ----------------------------------------------------
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=0.118, location=(0, 0, 0.50))
    dome = bpy.context.object
    dome.name = "Dome"
    dome.scale = (1.0, 1.0, 0.62)
    dome.data.materials.append(red)
    shade_smooth(dome)
    parts.append(dome)

    # --- rounded base ------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.121, depth=0.035, location=(0, 0, 0.095))
    foot = bpy.context.object
    foot.name = "Foot"
    foot.data.materials.append(steel)
    bevel(foot, 0.012, 5)
    shade_smooth(foot)
    parts.append(foot)

    # --- label band --------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.1192, depth=0.125, location=(0, 0, 0.268))
    band = bpy.context.object
    band.name = "Label"
    band.data.materials.append(label)
    shade_smooth(band)
    parts.append(band)

    # --- neck --------------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.030, depth=0.075, location=(0, 0, 0.590))
    neck = bpy.context.object
    neck.name = "Neck"
    neck.data.materials.append(brass)
    shade_smooth(neck)
    parts.append(neck)

    # --- valve head --------------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.042, depth=0.055, location=(0, 0, 0.647))
    valve = bpy.context.object
    valve.name = "Valve"
    valve.data.materials.append(brass)
    bevel(valve, 0.006, 3)
    shade_smooth(valve)
    parts.append(valve)

    # --- squeeze lever (top) ----------------------------------------------
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.010, 0, 0.691))
    lever = bpy.context.object
    lever.name = "Lever"
    lever.scale = (0.105, 0.020, 0.011)
    lever.rotation_euler = (0, math.radians(-7), 0)
    lever.data.materials.append(steel)
    bevel(lever, 0.005, 3)
    shade_smooth(lever)
    parts.append(lever)

    # --- carry handle (lower fixed grip) ----------------------------------
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(-0.052, 0, 0.665))
    grip = bpy.context.object
    grip.name = "Grip"
    grip.scale = (0.055, 0.017, 0.009)
    grip.data.materials.append(steel)
    bevel(grip, 0.004, 3)
    shade_smooth(grip)
    parts.append(grip)

    # --- pressure gauge ----------------------------------------------------
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.027, depth=0.016, location=(0.062, -0.040, 0.632))
    gauge = bpy.context.object
    gauge.name = "Gauge"
    gauge.rotation_euler = (math.radians(90), 0, math.radians(20))
    gauge.data.materials.append(brass)
    shade_smooth(gauge)
    parts.append(gauge)

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.022, depth=0.003, location=(0.067, -0.049, 0.632))
    dial = bpy.context.object
    dial.name = "GaugeFace"
    dial.rotation_euler = (math.radians(90), 0, math.radians(20))
    dial.data.materials.append(face)
    shade_smooth(dial)
    parts.append(dial)

    # --- hose --------------------------------------------------------------
    curve = bpy.data.curves.new("HoseCurve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.011
    curve.bevel_resolution = 8
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(3)
    coords = [(-0.032, -0.012, 0.640), (-0.176, -0.088, 0.500), (-0.196, -0.070, 0.286), (-0.140, -0.030, 0.168)]
    for point, co in zip(spline.bezier_points, coords):
        point.co = Vector(co)
        point.handle_left_type = point.handle_right_type = "AUTO"
    hose = bpy.data.objects.new("Hose", curve)
    bpy.context.collection.objects.link(hose)
    hose.data.materials.append(rubber)
    parts.append(hose)

    # --- horn / nozzle ------------------------------------------------------
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.052, radius2=0.020, depth=0.105,
                                    location=(-0.146, -0.026, 0.116))
    horn = bpy.context.object
    horn.name = "Horn"
    horn.rotation_euler = (math.radians(16), 0, math.radians(-14))
    horn.data.materials.append(rubber)
    shade_smooth(horn)
    parts.append(horn)

    return parts


def build_floor():
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "Floor"
    floor.data.materials.append(material("Floor", (0.013, 0.012, 0.011), roughness=0.34,
                                       rough_variation=0.06, bump=0.03, noise_scale=60))
    return floor


def aim_at(obj, target):
    """Point an object's -Z at a target.

    Hand-computed Euler angles are guesswork the moment a light moves; a Track-To
    constraint always aims correctly, which is why the first accent rim missed entirely.
    """
    con = obj.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"


def build_target():
    target = bpy.data.objects.new("AimTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 0.40)
    return target


def build_lighting(target):
    """Key, accent rim, and a low fill. The brand colour arrives as light, never as paint."""
    bpy.ops.object.light_add(type="AREA", location=(-1.35, -1.55, 1.95))
    key = bpy.context.object
    key.name = "Key"
    key.data.energy = 96
    key.data.size = 1.6
    key.data.color = (1.0, 0.96, 0.90)
    aim_at(key, target)

    # Behind and to the right, low enough to skim the silhouette rather than wash the face.
    bpy.ops.object.light_add(type="AREA", location=(0.46, 0.40, 0.78))
    rim = bpy.context.object
    rim.name = "Rim"
    rim.data.energy = 54
    rim.data.size = 0.13
    rim.data.color = ACCENT
    # Sitting this close, the light would otherwise appear as a bright rectangle in shot.
    rim.visible_camera = False
    aim_at(rim, target)

    # Second, cooler rim on the opposite edge keeps the dark side from going solid black.
    bpy.ops.object.light_add(type="AREA", location=(-0.62, 0.46, 0.92))
    rim2 = bpy.context.object
    rim2.name = "RimCool"
    rim2.data.energy = 6
    rim2.data.size = 0.16
    rim2.data.color = (0.62, 0.74, 1.0)
    rim2.visible_camera = False
    aim_at(rim2, target)

    bpy.ops.object.light_add(type="AREA", location=(1.05, -1.75, 0.55))
    fill = bpy.context.object
    fill.name = "Fill"
    fill.data.energy = 9
    fill.data.size = 3.0
    fill.data.color = (0.72, 0.80, 1.0)
    aim_at(fill, target)

    # The world is built by build_environment(); a flat dark background here would
    # overwrite the gradient the metals rely on.


def build_environment(target):
    """Give polished surfaces something to reflect, via the world rather than geometry.

    The first attempt used emissive panels hidden from the camera. That cannot work in
    EEVEE: its ray tracing is screen-space, so geometry outside the frame contributes
    nothing to a reflection. The world background is always available to reflection rays in
    both engines, so a vertical gradient — cool above, warm at the horizon, black below —
    gives the brass and steel a graded highlight that reads as shape.
    """
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    nt = world.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_WORLD":
            nt.nodes.remove(node)

    tex = nt.nodes.new("ShaderNodeTexCoord")
    tex.location = (-900, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-700, 0)
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-500, 0)
    cr = ramp.color_ramp
    cr.elements[0].position = 0.30
    cr.elements[0].color = (0.004, 0.004, 0.005, 1.0)   # below horizon: near black
    cr.elements[1].position = 0.52
    cr.elements[1].color = (0.090, 0.058, 0.020, 1.0)   # horizon: warm
    e2 = cr.elements.new(0.78)
    e2.color = (0.020, 0.026, 0.042, 1.0)               # above: cool, dim
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])

    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (-260, 0)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], nt.nodes["World Output"].inputs["Surface"])

    bpy.context.scene.world = world


def build_camera(target, lens=52.0, shift_x=0.0):
    bpy.ops.object.camera_add(location=(0.94, -1.86, 0.74))
    cam = bpy.context.object
    cam.name = "Camera"
    cam.data.lens = lens
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = 2.05
    cam.data.dof.aperture_fstop = 2.6
    # Negative shift pushes the subject right in frame, leaving the left third for the
    # headline. Composing in-camera beats cropping a centred render later.
    cam.data.shift_x = shift_x

    aim_at(cam, target)
    bpy.context.scene.camera = cam
    return cam


# --------------------------------------------------------------------------- passes

def apply_clay(parts, floor):
    """Uniform grey. Structure only — this is the white-model reference for the AI pass."""
    clay = material("Clay", (0.55, 0.55, 0.55), roughness=0.62)
    for obj in [*parts, floor]:
        if obj.type != "MESH" and obj.type != "CURVE":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(clay)


def flatten_materials_for_gltf():
    """glTF stores scalar PBR values; it cannot carry Blender's procedural node graphs.

    The noise-driven roughness and bump that keep the RENDER from looking like untouched CG
    have no glTF representation, so exporting them silently produces a flat material anyway.
    Removing the links is the honest version of that: `default_value` on each socket still
    holds the scalar `material()` assigned before it linked anything, so base colour,
    metallic and roughness export exactly as authored. The browser supplies its own
    environment lighting, which is where the surface interest comes from on the web.
    """
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            continue
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        for socket_name in ("Base Color", "Roughness", "Normal"):
            socket = bsdf.inputs.get(socket_name)
            if socket is None:
                continue
            for link in list(socket.links):
                nt.links.remove(link)
        for node in list(nt.nodes):
            if node.type in {"TEX_NOISE", "VALTORGB", "BUMP"}:
                nt.nodes.remove(node)


def curves_to_mesh(parts):
    """The hose is a bevelled Bezier curve. glTF has no curve primitive."""
    for obj in parts:
        if obj.type != "CURVE":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")


def export_glb(parts, out):
    """Export the inspected parts as a browser asset, names intact.

    Part names are load-bearing, not cosmetic: the viewer looks up `Gauge`, `Lever` and
    `Hose` by name to attach hotspots and to drive the exploded view. Merging meshes to
    lower draw calls would break both, so it is deliberately not done.
    """
    curves_to_mesh(parts)
    flatten_materials_for_gltf()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        # Applies the bevel modifiers. Without it the exported edges are unbevelled and the
        # silhouette stops matching the rendered film.
        export_apply=True,
        # Blender is Z-up, glTF is Y-up. Keeping the default conversion means the viewer must
        # map a Blender feature point [x, y, z] to [x, z, -y]; see InspectionModel.tsx.
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print("GLB_PARTS", ",".join(obj.name for obj in parts))


def configure_render(scene, engine, width, height, samples, transparent):
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.film_transparent = transparent
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"

    if engine == "CYCLES":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.02
        scene.cycles.max_bounces = 8
    else:
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = samples
        if hasattr(scene.eevee, "use_raytracing"):
            # Off by default. Screen-space only, so it improves on-screen contact
            # reflections; off-screen shape still comes from the world gradient.
            scene.eevee.use_raytracing = True
            rt = getattr(scene.eevee, "ray_tracing_options", None)
            if rt is not None:
                rt.resolution_scale = "1"
                rt.screen_trace_quality = 0.5


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["beauty", "clay", "flight", "glb"], default="beauty")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=2000)
    ap.add_argument("--height", type=int, default=1500)
    ap.add_argument("--samples", type=int, default=160)
    ap.add_argument("--frames", type=int, default=1, help="flight mode: frame count")
    ap.add_argument("--engine", choices=["cycles", "eevee"], default=None,
                    help="override the default engine for the mode")
    ap.add_argument("--manifest", default=None,
                    help="src/content/inspection-flight.json — owns the camera beats")
    ap.add_argument("--no-env", action="store_true",
                    help="omit reflection panels (clay/structure passes do not need them)")
    ap.add_argument("--lens", type=float, default=52.0)
    ap.add_argument("--shift-x", type=float, default=0.0, dest="shift_x",
                help="camera shift; negative moves the subject right in frame")
    ap.add_argument("--transparent", action="store_true", help="film-transparent + shadow catcher")
    args = ap.parse_args(argv)

    clear_scene()
    parts = build_extinguisher()

    # The browser owns lighting, camera and ground for the interactive model, so building a
    # set here would only export geometry the viewer throws away.
    if args.mode == "glb":
        export_glb(parts, args.out)
        print("RENDER_DONE", args.mode, args.out)
        return

    floor = build_floor()
    target = build_target()
    build_lighting(target)
    if not args.no_env:
        build_environment(target)
    cam = build_camera(target, args.lens, args.shift_x)

    if args.mode == "clay":
        apply_clay(parts, floor)

    if args.transparent:
        floor.is_shadow_catcher = True

    scene = bpy.context.scene
    if args.engine:
        engine = "CYCLES" if args.engine == "cycles" else "BLENDER_EEVEE"
    else:
        engine = "CYCLES" if args.mode == "beauty" else "BLENDER_EEVEE"
    configure_render(scene, engine, args.width, args.height, args.samples, args.transparent)

    if args.mode == "flight":
        if not args.manifest:
            raise SystemExit("flight mode requires --manifest")
        manifest = json.load(open(args.manifest, encoding="utf-8"))
        beats = manifest["beats"]
        scene.frame_start = 1
        scene.frame_end = manifest["frames"]
        scene.render.fps = manifest["fps"]

        # Each beat gets an ARRIVE keyframe partway in and a HOLD keyframe at its end with
        # identical values. The camera therefore settles on the inspection point and stays
        # there while the label is readable, instead of drifting continuously past it.
        for i, beat in enumerate(beats):
            c = beat["camera"]
            feature = Vector(c["feature"])
            loc = orbit_position(feature, c["azimuth"], c["elevation"], c["distance"])
            # Focus on the part being inspected, so the beat's subject is the sharp thing.
            focus = (loc - feature).length
            span = beat["endFrame"] - beat["startFrame"]
            arrive = beat["startFrame"] + int(round(0.45 * span))

            # An optional entry pose gives the FIRST beat something to move from. Without
            # it the opening beat keyframes one camera at both its arrive and hold points,
            # rendering identical frames — dead scroll for a whole viewport height.
            entry = c.get("entry")
            if entry is not None:
                e_feature = Vector(entry["feature"])
                e_loc = orbit_position(e_feature, entry["azimuth"], entry["elevation"],
                                       entry["distance"])
                cam.location = e_loc
                cam.data.lens = entry["lens"]
                cam.data.dof.focus_distance = (e_loc - e_feature).length
                target.location = e_feature
                cam.keyframe_insert("location", frame=beat["startFrame"])
                cam.data.keyframe_insert("lens", frame=beat["startFrame"])
                cam.data.dof.keyframe_insert("focus_distance", frame=beat["startFrame"])
                target.keyframe_insert("location", frame=beat["startFrame"])
            elif i == 0:
                arrive = beat["startFrame"]

            # A dwell holds the subject long enough to read its label, but keying the SAME
            # camera at both arrive and hold froze the picture: measured at 53% of frames
            # visually static, with a 19-frame dead run. A slow continued drift through the
            # dwell keeps the shot alive — the same reason a real push-in never fully stops.
            drift_az = c.get("driftAzimuth", 2.6)
            drift_scale = c.get("driftDistance", 0.962)
            poses = [
                (arrive, loc, focus),
                (beat["endFrame"],
                 orbit_position(feature, c["azimuth"] + drift_az, c["elevation"],
                                c["distance"] * drift_scale),
                 focus * drift_scale),
            ]
            for frame, pose_loc, pose_focus in poses:
                cam.location = pose_loc
                cam.data.lens = c["lens"]
                cam.data.dof.focus_distance = pose_focus
                target.location = feature
                cam.keyframe_insert("location", frame=frame)
                cam.data.keyframe_insert("lens", frame=frame)
                cam.data.dof.keyframe_insert("focus_distance", frame=frame)
                target.keyframe_insert("location", frame=frame)

        # Bezier with automatic-clamped handles: eased departures and arrivals, and no
        # overshoot past a keyed position (which would push the subject out of frame).
        for obj in (cam, target, cam.data):
            if obj.animation_data and obj.animation_data.action:
                for fcurve in iter_fcurves(obj.animation_data.action):
                    for kp in fcurve.keyframe_points:
                        kp.interpolation = "BEZIER"
                        kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"

        scene.render.filepath = args.out
        bpy.ops.render.render(animation=True)
    else:
        scene.render.filepath = args.out
        bpy.ops.render.render(write_still=True)

    print("RENDER_DONE", args.mode, args.out)


if __name__ == "__main__":
    main()
