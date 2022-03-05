import { GsAlphaTestMethod, ShaderType } from "ntdf-modding-toolkit";

let alpha_test_mapping : Record<GsAlphaTestMethod, string> = {
	[GsAlphaTestMethod.ALWAYS]: '1 == 1',
	[GsAlphaTestMethod.NEVER]: '0 == 1',
	[GsAlphaTestMethod.EQUAL]: 'alpha == alphaCompare',
	[GsAlphaTestMethod.GEQUAL]: 'alpha >= alphaCompare',
	[GsAlphaTestMethod.LEQUAL]: 'alpha <= alphaCompare',
	[GsAlphaTestMethod.GREATER]: 'alpha > alphaCompare',
	[GsAlphaTestMethod.LESS]: 'alpha < alphaCompare',
	[GsAlphaTestMethod.NOTEQUAL]: 'alpha != alphaCompare'
};

let attribs_3d = ["aPosition", "aColor", "aTexCoord", "aNormal"] as const;
let uniforms_3d = ["ambientColor", "lightingVecs", "lightingColors", "textureScroll", "alphaCompare", "isFailPass", "projMatrix", "viewMatrix", "mainSampler", "metallic", "colorMult", "cameraPos"] as const;
function shader_code(type : ShaderType, alpha_test : GsAlphaTestMethod) : [string, string] {
	let color_mul = (type === ShaderType.Unlit || type === ShaderType.UnlitNormals ? 0xff/0x80 : 0xff/0x10).toFixed(5);
	return [
`
precision highp float;

attribute vec3 aPosition;
attribute vec4 aColor;
attribute vec2 aTexCoord;
${type !== ShaderType.Unlit ? 
`
	attribute vec3 aNormal;
	uniform vec3 ambientColor;
	uniform vec3 lightingVecs[3];
	uniform vec3 lightingColors[3];
` : ``}
uniform vec2 textureScroll;

uniform mat4 projMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPos;
uniform int metallic;
uniform vec4 colorMult;

varying vec4 vColor;
varying vec2 vTexCoord;
void main() {
	vec4 color = aColor * ${color_mul};
	${type !== ShaderType.Unlit ? `
		vec3 reflect_dir = reflect(normalize(aPosition - cameraPos), aNormal);
	` : ``}
	${type === ShaderType.SpecularRigged ? `
		color.a = 1.0;
	` : ``}
	${type !== ShaderType.Unlit ? `
		if(metallic != 0) {
			vTexCoord = vec2(-reflect_dir.z, reflect_dir.y) * 0.5 + vec2(0.5,0.5);
		} else {
			vTexCoord = aTexCoord + textureScroll;
		}
	` : `
		vTexCoord = aTexCoord + textureScroll;
	`}
	color *= colorMult;
	vColor = color;
	gl_Position = projMatrix * viewMatrix * vec4(aPosition, 1.0);
}
`,
`
precision mediump float;

varying vec4 vColor;
varying vec2 vTexCoord;
uniform float alphaCompare;
uniform int isFailPass;

uniform sampler2D mainSampler;

void main() {
	vec4 color = clamp(texture2D(mainSampler, vTexCoord) * vColor, 0.0, 1.0);
	float alpha = color.a;
	if((${alpha_test_mapping[alpha_test]}) == (isFailPass != 0)) discard;
	gl_FragColor = color;
}
`
	];
}

const attribs_basic_3d = ["aPosition", "aColor"] as const;
const uniforms_basic_3d = ["colorMult", "projMatrix", "viewMatrix"] as const;
function basic_shader_code() : [string, string] {
	return [
`
precision highp float;
attribute vec3 aPosition;
attribute vec4 aColor;
uniform vec4 colorMult;
uniform mat4 projMatrix;
uniform mat4 viewMatrix;

varying vec4 vColor;
void main() {
	vColor = colorMult * aColor;
	gl_Position = projMatrix * viewMatrix * vec4(aPosition, 1);
}
`,`
precision mediump float;

varying vec4 vColor;

void main() {
	vec4 c = gl_FragCoord;
	gl_FragColor = vColor;
}
`
	]
}

const program_cache = new WeakMap<WebGLRenderingContext, Map<string, ShaderInfo<any,any>>>();

function bind_shader<A extends readonly string[], U extends readonly string[]>(
	gl : WebGLRenderingContext, key : string,
	generator : ()=>[string,string],
	attribs : A,
	uniforms : U,
) : ShaderInfo<A,U> {
	let gl_cache = program_cache.get(gl);
	if(!gl_cache) {
		gl_cache = new Map();
		program_cache.set(gl, gl_cache);
	}
	let shader_info = gl_cache.get(key) as ShaderInfo<A,U>;
	if(!shader_info) {
		let [vcode, fcode] = generator();
		let vs = gl.createShader(gl.VERTEX_SHADER);
		let fs = gl.createShader(gl.FRAGMENT_SHADER);
		let prog = gl.createProgram();
		if(!vs || !fs || !prog) {
			throw new Error("shader creation failed");
		}
		gl.shaderSource(vs, vcode);
		gl.shaderSource(fs, fcode);
		gl.compileShader(vs);
		gl.compileShader(fs);
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			throw new Error(`Could not compile WebGL program\n\n${gl.getProgramInfoLog(prog)}\n${vcode}\n${gl.getShaderInfoLog(vs)}\n${fcode}\n${gl.getShaderInfoLog(fs)}`);
		}
		shader_info = build_shader_info(gl, prog, attribs, uniforms);
		gl_cache.set(key, shader_info);
	}
	gl.useProgram(shader_info.program);
	return shader_info;
}

export function bind_shader_3d(gl : WebGLRenderingContext, type = ShaderType.Unlit, alpha_test = GsAlphaTestMethod.GREATER) {
	return bind_shader(gl, ["3d", type, alpha_test].join(","), () => shader_code(type, alpha_test), attribs_3d, uniforms_3d);
}

export function bind_shader_basic_3d(gl : WebGLRenderingContext) {
	return bind_shader(gl, "basic", basic_shader_code, attribs_basic_3d, uniforms_basic_3d);
}

type ShaderInfo<A extends readonly string[], U extends readonly string[]> = {
	[P in (A[number]|U[number]|"program")] : P extends "program" ? WebGLProgram : (P extends A[number] ? number : WebGLUniformLocation|null);
	/*
	In a way that makes more sense:
	[P in A[number]] : number;
	[P in U[number]] : WebGLUniformLocation|null;
	program: WebGLPRogram;
	*/
};

function build_shader_info<A extends readonly string[], U extends readonly string[]>(
	gl : WebGLRenderingContext,
	prog : WebGLProgram,
	attribs : A,
	uniforms : U,
) : ShaderInfo<A, U> {
	let obj : any = {program: prog};
	for(let attrib of attribs) {
		obj[attrib] = gl.getAttribLocation(prog, attrib);
	}
	for(let uniform of uniforms) {
		obj[uniform] = gl.getUniformLocation(prog, uniform);
	}
	return obj;
}

export function array_to_buffer(gl : WebGLRenderingContext, type : number, array : Uint8Array|Float32Array) {
	let buffer = gl.createBuffer();
	if(!buffer) {
		console.error("Failed to create WebGL buffer!");
		return undefined;
	}
	gl.bindBuffer(type, buffer);
	gl.bufferData(type, array, gl.STATIC_DRAW);
	return buffer;
}
