import { ExpandMore } from "@mui/icons-material";
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, ButtonGroup, Typography } from "@mui/material";
import { mat4, vec3, vec4 } from "gl-matrix";
import { CollisionChunk, ImageChunk, MaterialsChunk, ModelChunk, ModelNode, ModelNodeMesh, ModelNodeType } from "ntdf-modding-toolkit";
import React from "react";
import { draw_collision } from "./collision_render";
import { draw_mesh, preview_material } from "./mesh_render";

type ModelViewerProps = {
	visible: boolean,
	canvas_props? : React.DetailedHTMLProps<React.CanvasHTMLAttributes<HTMLCanvasElement>, HTMLCanvasElement>,
	container_props? : React.ComponentPropsWithRef<typeof Box>,
	model? : ModelChunk,
	collision? : CollisionChunk,
	materials? : MaterialsChunk,
	images? : ImageChunk[],
	preview_material_index? : number,
	display_mask? : number,
	set_display_mask? : (display_mask : number) => void,
	show_view_options? : boolean
};

export class ModelViewer extends React.Component<ModelViewerProps> {
	constructor(props:ModelViewerProps) {
		super(props);

		this.zoom = (props.model?.root?.radius ?? 5) * 2 + 1;
		if(props.model) {
			this.focus = [...props.model.root.center];
		}
	}

	zoom : number = 1;
	focus : [number,number,number] = [0,0,0];
	pointer_locked : boolean = false;

	pitch : number = 15 * Math.PI / 180;
	yaw : number = 0;
	has_mouse_dragged = false;

	display_mask : number = -1;
	get_display_mask() : number {
		return this.props.display_mask ?? this.display_mask;
	}
	set_display_mask(mask : number) : void {
		if(this.props.set_display_mask) this.props.set_display_mask(mask);
		else this.forceUpdate();
		this.display_mask = mask;
	}

	mousedown = (e1 : React.MouseEvent) => {
		let is_pan = e1.shiftKey;
		let last_event = e1.nativeEvent;

		let view_mat = mat4.create();
		mat4.rotateX(view_mat, view_mat, this.pitch);
		mat4.rotateY(view_mat, view_mat, this.yaw);
		mat4.invert(view_mat,view_mat);
		let up = [0,1,0] as vec3;
		let right = [1,0,0] as vec3;
		vec3.transformMat4(up,up,view_mat);
		vec3.transformMat4(right,right,view_mat);

		let mousemove = (e : MouseEvent) => {
			let dx = e.clientX - last_event.clientX;
			let dy = e.clientY - last_event.clientY;
			if(is_pan) {
				let up_add = vec3.create();
				let right_add = vec3.create();
				vec3.scale(up_add, up, dy * this.zoom / 1000);
				vec3.scale(right_add, right, -dx * this.zoom / 1000);
				vec3.add(this.focus, this.focus, up_add);
				vec3.add(this.focus, this.focus, right_add);
			} else {
				this.yaw += dx * 0.01;
				this.pitch += dy * 0.01;
				this.has_mouse_dragged = true;
			}
			last_event = e;
		}
		let mouseup = (e : MouseEvent) => {
			document.removeEventListener("mousemove", mousemove, {capture: true});
			document.removeEventListener("mouseup", mouseup, {capture: true});
		}
		document.addEventListener("mousemove", mousemove, {capture: true});
		document.addEventListener("mouseup", mouseup, {capture: true});

	}

	doubleclick = () => {
		this.canvas_ref.current?.requestPointerLock();
	}

	mousemove = (e : React.MouseEvent) => {
		if(this.canvas_ref.current && this.canvas_ref.current === document.pointerLockElement && !this.keys_down.has("Escape")) {
			let dx = e.movementX;
			let dy = e.movementY;
			dx = Math.min(50, Math.max(-50, dx));
			dy = Math.min(50, Math.max(-50, dy));
			this.yaw += dx * 0.003;
			this.pitch += dy * 0.003;
			this.has_mouse_dragged = true;
		}
	}
	keys_down = new Set<string>();
	keydown = (e : React.KeyboardEvent) => {
		this.keys_down.add(e.code);
	}
	keyup = (e : React.KeyboardEvent) => {
		this.keys_down.delete(e.code);
	}

	wheel = (e : React.WheelEvent) => {
		let delta_y = e.deltaY;
		if(e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) delta_y /= 100;
		else if(e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta_y /= 3;
		if(this.pointer_locked) delta_y = -delta_y;
		this.zoom *= (2**(delta_y/10));
	}

	raf_on : number|undefined = undefined;
	raf_func = (timestamp : number) => {
		try {
			this.frame(timestamp);
		} catch(e) {
			console.error(e);
			this.raf_on = undefined;
			return;
		}
		this.raf_on = requestAnimationFrame(this.raf_func);
	}
	last_timestamp = -1;
	frame(timestamp : number) {
		let dt = this.last_timestamp >= 0 ? timestamp-this.last_timestamp : 0;
		this.last_timestamp = timestamp;

		let canvas = this.canvas_ref.current;
		if(!canvas) return;
		
		let rect = canvas.getBoundingClientRect();
		/*let width = Math.ceil(rect.width*window.devicePixelRatio);
		let height = Math.ceil(rect.height*window.devicePixelRatio);
		if(width !== canvas.width) canvas.width = width;
		if(height !== canvas.height) canvas.height = height;*/
		const gl = canvas.getContext('webgl');
		if(!gl) return;
		gl.getExtension("OES_element_index_uint");
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);

		let proj_mat = mat4.create();
		mat4.perspective(proj_mat, 60 * Math.PI / 180, rect.width/rect.height, 1, 10000);

		if(!this.has_mouse_dragged) this.yaw = timestamp / 2000;
		if(!this.pointer_locked && document.pointerLockElement === canvas) {
			this.pointer_locked = true;
			this.has_mouse_dragged = true;
			let pos_mat = mat4.create();
			mat4.translate(pos_mat, pos_mat, [0, 0, -this.zoom]);
			mat4.rotateX(pos_mat, pos_mat, this.pitch);
			mat4.rotateY(pos_mat, pos_mat, this.yaw);
			mat4.translate(pos_mat, pos_mat, this.focus.map(a => -a) as [number,number,number]);
			mat4.invert(pos_mat, pos_mat);
			mat4.getTranslation(this.focus, pos_mat);
		} else if(this.pointer_locked && document.pointerLockElement !== canvas) {
			this.pointer_locked = false;
			let pos_mat = mat4.create();
			mat4.translate(pos_mat, pos_mat, [0, 0, this.zoom]);
			mat4.rotateX(pos_mat, pos_mat, this.pitch);
			mat4.rotateY(pos_mat, pos_mat, this.yaw);
			mat4.translate(pos_mat, pos_mat, this.focus.map(a => -a) as [number,number,number]);
			mat4.invert(pos_mat, pos_mat);
			mat4.getTranslation(this.focus, pos_mat);
		}

		let view_mat = mat4.create();
		if(!this.pointer_locked) mat4.translate(view_mat, view_mat, [0, 0, -this.zoom]);
		mat4.rotateX(view_mat, view_mat, this.pitch);
		mat4.rotateY(view_mat, view_mat, this.yaw);
		if(this.pointer_locked) {
			let move_vec = vec4.create();
			move_vec[3] = 0;
			move_vec[0] = +this.keys_down.has("KeyD") - +this.keys_down.has("KeyA");
			move_vec[2] = +this.keys_down.has("KeyS") - +this.keys_down.has("KeyW");
			let inv = mat4.create();
			mat4.invert(inv, view_mat);
			vec4.transformMat4(move_vec, move_vec, inv);
			this.focus[0] += move_vec[0] * dt / 1000 * this.zoom;
			this.focus[1] += move_vec[1] * dt / 1000 * this.zoom;
			this.focus[2] += move_vec[2] * dt / 1000 * this.zoom;
		}
		mat4.translate(view_mat, view_mat, this.focus.map(a => -a) as [number,number,number]);

		if(this.props.model) {
			//this.draw_node(gl, this.props.model.root, proj_mat, view_mat, timestamp);
			this.draw_model(gl, this.props.model, proj_mat, view_mat, timestamp);
		}
		if(this.props.collision) {
			for(let object of this.props.collision.objects) {
				draw_collision(gl, object, proj_mat, view_mat);
			}
		}

		if(this.props.preview_material_index !== undefined && this.props.materials && this.props.images) {
			preview_material(gl, this.props.materials, this.props.images, this.props.preview_material_index, timestamp);
		}

		gl.colorMask(false,false,false,true);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.colorMask(true,true,true,true);
	}

	draw_model(gl : WebGLRenderingContext, model : ModelChunk, proj_mat : mat4, view_mat : mat4, timestamp : number) {
		let inv_view_mat = mat4.create();
		mat4.invert(inv_view_mat, view_mat);
		let camera_pos : [number,number,number] = [0,0,0];
		mat4.getTranslation(camera_pos, inv_view_mat);
		let nodes : ModelNodeMesh[] = [];
		let node_props = new Map<ModelNodeMesh, {sort_order:number, color_mult : [number,number,number,number]}>();
		this.index_node(gl, model.root, camera_pos, nodes, node_props, 0);
		nodes.sort((a, b) => {
			let af = this.props.materials?.materials[a.material]?.texture_file ?? -1;
			let bf = this.props.materials?.materials[b.material]?.texture_file ?? -1;
			if(af !== bf) return ((af&0xFF) - (bf&0xFF));
			return (node_props.get(a)?.sort_order ?? 0) - (node_props.get(b)?.sort_order ?? 0);
		})
		for(let node of nodes) {
			let props = node_props.get(node);
			draw_mesh(gl, node, proj_mat, view_mat, timestamp, props?.color_mult, this.props.materials, this.props.images);
		}
	}

	index_node(gl : WebGLRenderingContext, node : ModelNode, camera_pos : [number,number,number], nodes_out : ModelNodeMesh[], node_props : Map<ModelNodeMesh, {sort_order:number, color_mult : [number,number,number,number]}>, sort_order = 0, color_mult : [number,number,number,number] = [1,1,1,1]) {
		if(node.type === ModelNodeType.Mesh) {
			nodes_out.push(node);
			node_props.set(node, {sort_order, color_mult});
		} else if(node.type === ModelNodeType.LodGroup) {
			sort_order = node.sort_order
			let dist_diff = (vec3.dist(camera_pos, node.center) - node.radius - node.render_distance);
			if(dist_diff < 0 && (!node.display_mask || (this.get_display_mask() & node.display_mask))) {
				if(node.fade_rate) {
					color_mult = [...color_mult];
					color_mult[3] *= Math.min(1, -dist_diff / node.fade_rate);
				}
				if(node.c3) this.index_node(gl, node.c3, camera_pos, nodes_out, node_props, sort_order, color_mult);
			}
		} else {
			for(let child of node.children) this.index_node(gl, child, camera_pos, nodes_out, node_props, sort_order, color_mult);
		}
	}

	draw_node(gl : WebGLRenderingContext, node : ModelNode, proj_mat : mat4, view_mat : mat4, timestamp : number) {
		if(node.type === ModelNodeType.Mesh) {
			draw_mesh(gl, node, proj_mat, view_mat, timestamp, undefined, this.props.materials, this.props.images);
			for(let child of node.children) this.draw_node(gl, child, proj_mat, view_mat, timestamp);
		} else if(node.type === ModelNodeType.LodGroup) {
			let inv_view_mat = mat4.create();
			mat4.invert(inv_view_mat, view_mat);
			let camera_pos : [number,number,number] = [0,0,0];
			mat4.getTranslation(camera_pos, inv_view_mat);
			let dist_diff = (vec3.dist(camera_pos, node.center) - node.radius - node.render_distance);
			if(dist_diff <= 0) {
				if(node.c3) this.draw_node(gl, node.c3, proj_mat, view_mat, timestamp);
				if(node.c2) this.draw_node(gl, node.c2, proj_mat, view_mat, timestamp);
				if(node.c1) this.draw_node(gl, node.c1, proj_mat, view_mat, timestamp);
			}
			for(let child of node.children) this.draw_node(gl, child, proj_mat, view_mat, timestamp);
		} else {
			for(let child of node.children) this.draw_node(gl, child, proj_mat, view_mat, timestamp);
		}
	}

	componentDidMount() {
		if(this.canvas_ref.current && this.raf_on === undefined) {
			this.raf_on = requestAnimationFrame(this.raf_func);
			this.last_timestamp = -1;
		}
	}
	componentDidUpdate() {
		if(this.canvas_ref.current && this.raf_on === undefined) {
			this.raf_on = requestAnimationFrame(this.raf_func);
			this.last_timestamp = -1;
		} else if(!this.canvas_ref.current && this.raf_on !== undefined) {
			cancelAnimationFrame(this.raf_on);
			this.raf_on = undefined;
		}
	}
	componentWillUnmount() {
		if(this.raf_on !== undefined) {
			cancelAnimationFrame(this.raf_on);
			this.raf_on = undefined;
		}
	}

	canvas_ref = React.createRef<HTMLCanvasElement>();
	render(): React.ReactNode {
		return (
			<Box {...this.props.container_props}>
				{this.props.visible && <canvas
					style={{position: "absolute", width: '100%', height: '100%', ...this.props.canvas_props?.style}}
					width={2000}
					height={1000}
					{...this.props.canvas_props}
					ref={this.canvas_ref}
					onMouseDown={this.mousedown}
					onDoubleClick={this.doubleclick}
					onMouseMove={this.mousemove}
					onKeyDown={this.keydown}
					onKeyUp={this.keyup}
					onWheel={this.wheel}
					tabIndex={-1}
				/>}
				<Box sx={{maxWidth: 'sm', position: 'absolute'}}>
					{(this.props.show_view_options??true) && <Accordion>
						<AccordionSummary
							expandIcon={<ExpandMore />}
						>
							<Typography>View Options</Typography>
						</AccordionSummary>
						<AccordionDetails>
							<Typography>Display Mask:</Typography>
							{[3,2,1,0].map((i) => (
								<ButtonGroup key={i}>
									{[7,6,5,4,3,2,1,0].map((j) => (
										<Button
											key={j}
											sx={{width: 50}}
											variant={(this.get_display_mask() & (1 << (i*8+j))) ? "contained" : "outlined"}
											onClick={() => {
												this.set_display_mask(this.get_display_mask() ^ (1 << (i*8+j)));
											}}
										>{i*8+j}</Button>
									))}
								</ButtonGroup>
							))}
						</AccordionDetails>
					</Accordion>}
				</Box>
			</Box>
		)
	}
}