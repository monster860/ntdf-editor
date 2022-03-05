interface GlStateObj {
	current_vertex_attribs : number[]
}
const state_cache = new WeakMap<WebGLRenderingContext, GlStateObj>();
function get_state_obj(gl : WebGLRenderingContext) : GlStateObj {
	let obj = state_cache.get(gl);
	if(!obj) {
		obj = {
			current_vertex_attribs: []
		};
		state_cache.set(gl, obj);
	}
	return obj;
}

export function update_enabled_vertex_attribs(gl : WebGLRenderingContext, attribs : number[]) {
	let obj = get_state_obj(gl);
	for(let attrib of attribs) {
		if(!obj.current_vertex_attribs.includes(attrib)) {
			obj.current_vertex_attribs.push(attrib);
			gl.enableVertexAttribArray(attrib);
		}
	}
	for(let i = 0; i < obj.current_vertex_attribs.length; i++) {
		let attrib = obj.current_vertex_attribs[i];
		if(!attribs.includes(attrib)) {
			obj.current_vertex_attribs.splice(i, 1);
			i--;
			gl.disableVertexAttribArray(attrib);
		}
	}
}
