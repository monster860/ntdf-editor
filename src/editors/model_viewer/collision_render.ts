import { mat4 } from "gl-matrix";
import { CollisionObject } from "ntdf-modding-toolkit";
import { array_to_buffer, bind_shader_basic_3d } from "./shader";
import { update_enabled_vertex_attribs } from "./state";

interface CollisionGlData {
	vertices? : WebGLBuffer,
	indices? : WebGLBuffer,
	colors? : WebGLBuffer,
	indices_width : number,
	indices_count: number,
	vertices_count: number
};

const mesh_cache = new WeakMap<WebGLRenderingContext, Map<CollisionObject, CollisionGlData>>();

function build_mesh_data(gl : WebGLRenderingContext, collision : CollisionObject) : CollisionGlData {
	let {vertices, indices, types} = collision.to_mesh(undefined, true);
	let indices_arr : Uint8Array|Uint16Array|Uint32Array;
	let indices_width = gl.UNSIGNED_INT;

	let colors = types.map(a => [
		[128,255,255,255],
		[255,128,255,255]
	][a]).flat();
	
	if(vertices.length < 255) {indices_arr = new Uint8Array(indices); indices_width = gl.UNSIGNED_BYTE;}
	else if(vertices.length < 65535) {indices_arr = new Uint16Array(indices); indices_width = gl.UNSIGNED_SHORT;}
	else indices_arr = new Uint32Array(indices);

	let indices_buffer = gl.createBuffer() ?? undefined;
	if(indices_buffer) {
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices_buffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices_arr, gl.STATIC_DRAW);
	}

	return {
		vertices: array_to_buffer(gl, gl.ARRAY_BUFFER, new Float32Array(vertices)),
		colors : array_to_buffer(gl, gl.ARRAY_BUFFER, new Uint8Array(colors)),
		indices: indices_buffer,
		indices_width,
		indices_count: indices.length,
		vertices_count: vertices.length
	};
}

export function draw_collision(gl : WebGLRenderingContext, collision : CollisionObject, proj_mat : mat4, view_mat : mat4) {
	let gl_cache = mesh_cache.get(gl);
	if(!gl_cache) {
		gl_cache = new Map();
		mesh_cache.set(gl, gl_cache);
	}
	let data = gl_cache.get(collision);
	if(!data) {
		data = build_mesh_data(gl, collision);
		gl_cache.set(collision, data);
	}

	let shader = bind_shader_basic_3d(gl);
	let attribs : number[] = [];
	if(data.vertices && shader.aPosition >= 0) {
		attribs.push(shader.aPosition);
		gl.bindBuffer(gl.ARRAY_BUFFER, data.vertices);
		gl.vertexAttribPointer(shader.aPosition, 3, gl.FLOAT, false, 0, 0);
	}
	if(data.colors && shader.aColor >= 0) {
		attribs.push(shader.aColor);
		gl.bindBuffer(gl.ARRAY_BUFFER, data.colors);
		gl.vertexAttribPointer(shader.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);
	}

	gl.uniformMatrix4fv(shader.viewMatrix, false, view_mat);
	gl.uniformMatrix4fv(shader.projMatrix, false, proj_mat);
	gl.uniform4f(shader.colorMult, 1,1,1,1);

	update_enabled_vertex_attribs(gl, attribs);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, data.indices ?? null);

	gl.disable(gl.BLEND);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);

	gl.depthMask(true);
	gl.drawElements(gl.LINES, data.indices_count, data.indices_width, 0);
}