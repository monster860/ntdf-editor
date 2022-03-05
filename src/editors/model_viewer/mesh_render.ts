import { mat4 } from "gl-matrix";
import { BufferList, GsAlphaFailMethod, GsAlphaTestMethod, ImageChunk, Material, MaterialPass, MaterialsChunk, ModelChunk, ModelNodeMesh, ShaderType } from "ntdf-modding-toolkit";
import { apply_blend_equation } from "./blend";
import { array_to_buffer, bind_shader_3d } from "./shader";
import { update_enabled_vertex_attribs } from "./state";
import { get_blank_texture, get_material_texture } from "./textures";

interface MeshGlData {
	vertices? : WebGLBuffer,
	normals? : WebGLBuffer,
	uv? : WebGLBuffer,
	uv2? : WebGLBuffer,
	colors? : WebGLBuffer,
	weights? : WebGLBuffer,
	joints? : WebGLBuffer,
	indices? : WebGLBuffer,
	indices_width : number,
	indices_count: number,
	vertices_count: number
};

const mesh_cache = new WeakMap<WebGLRenderingContext, Map<ModelNodeMesh|MeshFunc, MeshGlData>>();

export function build_mesh_data(gl : WebGLRenderingContext, node : ModelNodeMesh) : MeshGlData {
	let [buffer_lists, total_verts] = ModelChunk.get_mesh_buffers(node);
	
	let indices : number[] = [];
	for(let list of buffer_lists) {
		if(!list.kick_flags) continue;
		let flags_arr = new Uint8Array(list.kick_flags);
		for(let i = 2; i < list.num_vertices; i++) {
			if(flags_arr[i] >= 0x80) {
				continue;
			}
			if(i % 2) {
				indices.push(list.vertex_start+i-2);
				indices.push(list.vertex_start+i-1);
			} else {
				indices.push(list.vertex_start+i-1);
				indices.push(list.vertex_start+i-2);
			}
			indices.push(list.vertex_start+i);
		}
	}
	let indices_arr : Uint8Array|Uint16Array|Uint32Array;
	let indices_width = gl.UNSIGNED_INT;
	if(total_verts < 255) {indices_arr = new Uint8Array(indices); indices_width = gl.UNSIGNED_BYTE;}
	else if(total_verts < 65535) {indices_arr = new Uint16Array(indices); indices_width = gl.UNSIGNED_SHORT;}
	else indices_arr = new Uint32Array(indices);

	let indices_buffer = gl.createBuffer() ?? undefined;
	if(indices_buffer) {
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices_buffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices_arr, gl.STATIC_DRAW);
	}

	return {
		vertices: get_mesh_data_buffer(gl, buffer_lists, "vertices", total_verts, 3),
		normals: get_mesh_data_buffer(gl, buffer_lists, "normals", total_verts, 3),
		uv: get_mesh_data_buffer(gl, buffer_lists, "uv", total_verts, 2),
		uv2: get_mesh_data_buffer(gl, buffer_lists, "uv2", total_verts, 2),
		colors: get_mesh_data_buffer(gl, buffer_lists, "colors", total_verts, 4, true),
		weights : get_mesh_data_buffer(gl, buffer_lists, "weights", total_verts, 3),
		joints : get_mesh_data_buffer(gl, buffer_lists, "joints", total_verts, 3, true),
		indices: indices_buffer,
		indices_width,
		indices_count: indices.length,
		vertices_count: total_verts
	};
}

const identity:mat4 = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

const material_preview_cache = new WeakMap<Material, MeshFunc>();
export function preview_material(gl : WebGLRenderingContext, materials : MaterialsChunk, images : ImageChunk[], index : number, timestamp : number) {
	let material = materials.materials[index];
	let preview = material_preview_cache.get(material);
	if(!preview) {
		preview = {
			material: index,
			get_data: (gl) => {
				return build_simple_square(gl, material.passes[0].shader_type === ShaderType.Unlit || material.passes[0].shader_type === ShaderType.UnlitNormals ? 128 : 16)
			}
		};
		material_preview_cache.set(material, preview);
	}
	draw_mesh(gl, preview, identity, identity, timestamp, undefined, materials, images);
}

function build_simple_square(gl : WebGLRenderingContext, brightness = 128) {
	let vertices = new Float32Array([
		-1, -1, 0,
		1, -1, 0,
		1, 1, 0,
		-1, 1, 0
	]);
	let uv = new Float32Array([
		0, 1,
		1, 1,
		1, 0,
		0, 0
	]);
	let normals = new Float32Array([
		0, 0, 1,
		0, 0, 1,
		0, 0, 1,
		0, 0, 1,
	]);
	let colors = new Uint8Array(4*4).fill(brightness);
	let weights = new Float32Array([
		1, 0, 0,
		1, 0, 0,
		1, 0, 0,
		1, 0, 0
	]);
	let joints = new Uint8Array([
		0, 0, 0,
		0, 0, 0,
		0, 0, 0,
		0, 0, 0,
	]);
	let indices = new Uint8Array([
		0, 1, 2, 0, 2, 3
	]);
	return {
		vertices: array_to_buffer(gl, gl.ARRAY_BUFFER, vertices),
		normals: array_to_buffer(gl, gl.ARRAY_BUFFER, normals),
		uv: array_to_buffer(gl, gl.ARRAY_BUFFER, uv),
		uv2: array_to_buffer(gl, gl.ARRAY_BUFFER, uv),
		colors: array_to_buffer(gl, gl.ARRAY_BUFFER, colors),
		weights : array_to_buffer(gl, gl.ARRAY_BUFFER, weights),
		joints : array_to_buffer(gl, gl.ARRAY_BUFFER, joints),
		indices: array_to_buffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices),
		indices_width: gl.UNSIGNED_BYTE,
		indices_count: 6,
		vertices_count: 4
	};
}

// https://stackoverflow.com/a/49752227
type KeyOfType<T, V> = keyof {
	[P in keyof T as T[P] extends V? P: never]: any
};

function get_mesh_data_buffer(gl : WebGLRenderingContext, lists : BufferList[], field_name : KeyOfType<BufferList, ArrayBuffer|undefined>, total_verts : number, elements_per_vert : number, is_bytes=false) : WebGLBuffer|undefined {
	if(!lists[0]?.[field_name]) return undefined;
	let array = is_bytes ? new Uint8Array(total_verts * elements_per_vert) : new Float32Array(total_verts * elements_per_vert);
	for(let list of lists) {
		let len = list.num_vertices*elements_per_vert;
		let index = list.vertex_start*elements_per_vert;
		let buf = list[field_name];
		if(!buf) {
			console.log("Inconsistently missing " + field_name);
			continue;
		}
		let dv = new DataView(buf);
		if(is_bytes) {
			for(let i = 0; i < len; i++) {
				array[index++] = dv.getUint8(i);
			}
		} else {
			for(let i = 0; i < len; i++) {
				array[index++] = dv.getFloat32(i*4, true);
			}
		}
		if(index > array.length) {
			console.error("index exceeded array size!" + index + " > " + array.length);
		}
	}
	return array_to_buffer(gl, gl.ARRAY_BUFFER, array);
}

type MeshFunc = {
	material: number,
	get_data: (gl : WebGLRenderingContext) => MeshGlData
};

export function draw_mesh(gl : WebGLRenderingContext, node : ModelNodeMesh|MeshFunc, proj_mat : mat4, view_mat : mat4, timestamp : number, color_mult? : [number,number,number,number], materials? : MaterialsChunk, images? : ImageChunk[]) {
	let gl_cache = mesh_cache.get(gl);
	if(!gl_cache) {
		gl_cache = new Map();
		mesh_cache.set(gl, gl_cache);
	}
	let data = gl_cache.get(node);
	if(!data) {
		data = ("get_data" in node) ? node.get_data(gl) : build_mesh_data(gl, node);
		gl_cache.set(node, data);
	}

	let passes : MaterialPass[] = [new MaterialPass()];
	passes[0].shader_type = data.normals ? ShaderType.Lit : ShaderType.Unlit;

	let material : Material|undefined;
	if(materials) {
		material = materials.materials[node.material];
	}
	if(material) passes = material.passes;

	for(let [pass_index, pass] of passes.entries()) {

		let shader = bind_shader_3d(gl, passes[pass_index].shader_type, passes[pass_index].alpha_test_on ? passes[pass_index].alpha_test_method : GsAlphaTestMethod.ALWAYS);
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
		if(data.uv && shader.aTexCoord >= 0) {
			attribs.push(shader.aTexCoord);
			gl.bindBuffer(gl.ARRAY_BUFFER, data.uv);
			gl.vertexAttribPointer(shader.aTexCoord, 2, gl.FLOAT, false, 0, 0);
		}
		if(data.normals && shader.aNormal >= 0) {
			attribs.push(shader.aNormal);
			gl.bindBuffer(gl.ARRAY_BUFFER, data.normals);
			gl.vertexAttribPointer(shader.aNormal, 3, gl.FLOAT, false, 0, 0);
		}
	
		gl.uniformMatrix4fv(shader.viewMatrix, false, view_mat);
		gl.uniformMatrix4fv(shader.projMatrix, false, proj_mat);
		let inv_mat : mat4 = mat4.create();
		let camera_pos : [number,number,number]	= [0,0,0];
		mat4.invert(inv_mat, view_mat);
		mat4.getTranslation(camera_pos, inv_mat);
		gl.uniform3fv(shader.cameraPos, camera_pos);

		if(pass_index === 1 && data.uv2 && shader.aTexCoord >= 0) {
			gl.bindBuffer(gl.ARRAY_BUFFER, data.uv2);
			gl.vertexAttribPointer(shader.aTexCoord, 2, gl.FLOAT, false, 0, 0);
		}

		let scroll_x = pass.scroll_rate_x * 60/1000*timestamp;
		let scroll_y = pass.scroll_rate_y * 60/1000*timestamp;
		scroll_x -= Math.floor(scroll_x);
		scroll_y -= Math.floor(scroll_y);
		gl.uniform2f(shader.textureScroll, scroll_x, scroll_y);
		gl.uniform1f(shader.alphaCompare, pass.alpha_test_ref);
		if(color_mult) {
			gl.uniform4fv(shader.colorMult, color_mult);
		} else {
			gl.uniform4f(shader.colorMult, 1, 1, 1, 1);
		}

		gl.uniform1i(shader.metallic, pass.metallic ? 1 : 0);

		update_enabled_vertex_attribs(gl, attribs);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, data.indices ?? null);

		apply_blend_equation(gl, pass);

		let texture = (material && images) ? get_material_texture(gl, images, material, pass_index) : get_blank_texture(gl);

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(shader.mainSampler, 0);

		gl.depthMask(true);
		gl.uniform1i(shader.isFailPass, 0);
		gl.drawElements(gl.TRIANGLES, data.indices_count, data.indices_width, 0);
		if(pass.alpha_test_on && pass.alpha_fail_method !== GsAlphaFailMethod.KEEP) {
			if(pass.alpha_fail_method === GsAlphaFailMethod.ZB_ONLY) {
				gl.blendEquation(gl.FUNC_ADD);
				gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ZERO);
			} else {
				gl.depthMask(false);
			}
			gl.uniform1i(shader.isFailPass, 1);
			gl.drawElements(gl.TRIANGLES, data.indices_count, data.indices_width, 0);
		}
	}
}