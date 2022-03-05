import { GsFilter, GsStorageFormat, GsWrapMode, ImageChunk, Material } from "ntdf-modding-toolkit";

const texture_caches = new WeakMap<WebGLRenderingContext, Map<string, WebGLTexture>>();

function get_texture_cache(gl : WebGLRenderingContext) {
	let cache = texture_caches.get(gl);
	if(!cache) {
		cache = new Map();
		texture_caches.set(gl, cache);
	}
	return cache;
}

export function get_blank_texture(gl : WebGLRenderingContext) : WebGLTexture {
	let cache = get_texture_cache(gl);
	let texture : WebGLTexture|null|undefined = cache.get("_blank");
	if(!texture) {
		texture = gl.createTexture();
		if(!texture) throw new Error("Failed to make texture");
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0x80,0x80,0x80,0xff]));
		cache.set("_blank", texture);
	}
	return texture;
}

export function get_material_texture(gl : WebGLRenderingContext, images : ImageChunk[], material : Material, pass_index : number) : WebGLTexture {
	if(material.texture_file < 0) return get_blank_texture(gl);
	let cache = get_texture_cache(gl);

	let pass = material.passes[pass_index];
	let image = images[material.texture_file];
	if(!image || !pass) return get_blank_texture(gl);

	let key = [material.texture_file, pass.texture_format, pass.wrap_h, pass.wrap_v, pass.mag_filter, pass.min_filter, pass.texture_log_width, pass.texture_log_height, pass.clut_location, ...pass.texture_location].join(",");

	let texture : WebGLTexture|null|undefined = cache.get(key);
	if(!texture) {
		const wrap_map : Record<GsWrapMode, number> = {
			[GsWrapMode.CLAMP]: gl.CLAMP_TO_EDGE,
			[GsWrapMode.REPEAT]: gl.REPEAT,
			[GsWrapMode.REGION_CLAMP]: gl.CLAMP_TO_EDGE,
			[GsWrapMode.REGION_REPEAT]: gl.REPEAT
		};
		const filter_map : Record<GsFilter, number> = {
			[GsFilter.LINEAR]: gl.LINEAR,
			[GsFilter.NEAREST]: gl.NEAREST,
			[GsFilter.LINEAR_MIPMAP_LINEAR]: gl.LINEAR_MIPMAP_LINEAR,
			[GsFilter.LINEAR_MIPMAP_NEAREST]: gl.LINEAR_MIPMAP_NEAREST,
			[GsFilter.NEAREST_MIPMAP_LINEAR]: gl.NEAREST_MIPMAP_LINEAR,
			[GsFilter.NEAREST_MIPMAP_NEAREST]: gl.NEAREST_MIPMAP_NEAREST
		};

		texture = gl.createTexture();
		if(!texture) throw new Error("Failed to make texture");
		gl.bindTexture(gl.TEXTURE_2D, texture);
		for(let i = 0; i < pass.texture_location.length; i++) {
			if(pass.texture_log_width-i < 0 || pass.texture_log_height-i < 0 || i > 0) break;
			let width = 1<<(pass.texture_log_width-i);
			let height = 1<<(pass.texture_log_height-i);
			let data = image.export_indexed_data(
				{
					format: pass.texture_format,
					location: pass.texture_location[i],
					width, height,
					is_clut: false
				}, {
					format: GsStorageFormat.PSMCT32,
					location: pass.clut_location,
					width: 16, height: 16,
					is_clut: true
				}, false, true
			);
			gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap_map[pass.wrap_h]);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap_map[pass.wrap_v]);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter_map[pass.mag_filter]);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR ?? filter_map[pass.min_filter]);
		}
		
		cache.set(key, texture);
	}
	return texture;
}
