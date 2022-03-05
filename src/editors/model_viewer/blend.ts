import { GsAlphaParam, GsColorParam, GsDepthTestMethod, MaterialPass } from "ntdf-modding-toolkit";

export function apply_blend_equation(gl : WebGLRenderingContext, pass : MaterialPass) : boolean {
	if(!pass.depth_test_on || pass.depth_test_method === GsDepthTestMethod.ALWAYS) {
		gl.disable(gl.DEPTH_TEST);
	} else {
		gl.enable(gl.DEPTH_TEST);
		if(pass.depth_test_method === GsDepthTestMethod.GEQUAL) gl.depthFunc(gl.LEQUAL);
		else if(pass.depth_test_method === GsDepthTestMethod.GREATER) gl.depthFunc(gl.LESS);
		else gl.depthFunc(gl.NEVER);
	}

	if(pass.alpha_blend_a === pass.alpha_blend_b && pass.alpha_blend_d === GsColorParam.RgbSource) {
		gl.disable(gl.BLEND);
		return true;
	} else {
		gl.enable(gl.BLEND);
	}
	if(pass.alpha_blend_a === pass.alpha_blend_b) {
		if(pass.alpha_blend_d === GsColorParam.RgbSource) {
			gl.blendFunc(gl.ONE, gl.ZERO);
			gl.blendEquation(gl.FUNC_ADD);
		} else if(pass.alpha_blend_d === GsColorParam.RgbDest) {
			gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ZERO);
			gl.blendEquation(gl.FUNC_ADD);
		} else {
			gl.blendFuncSeparate(gl.ZERO, gl.ZERO, gl.ONE, gl.ZERO);
			gl.blendEquation(gl.FUNC_ADD);
		}
	} else {
		let alpha = pass.alpha_blend_c === GsAlphaParam.AlphaSource ? gl.SRC_ALPHA : (pass.alpha_blend_c === GsAlphaParam.AlphaDest ? gl.DST_ALPHA : gl.CONSTANT_ALPHA);
		let one_minus_alpha = pass.alpha_blend_c === GsAlphaParam.AlphaSource ? gl.ONE_MINUS_SRC_ALPHA : (pass.alpha_blend_c === GsAlphaParam.AlphaDest ? gl.ONE_MINUS_DST_ALPHA : gl.ONE_MINUS_CONSTANT_ALPHA);
		
		if(pass.alpha_blend_c === GsAlphaParam.Fix) {
			gl.blendColor(1, 1, 1, pass.alpha_blend_value);
		}

		if(pass.alpha_blend_b === pass.alpha_blend_d) {
			//becomes (a - b) * c + b => ac + b(1 - c)
			gl.blendFuncSeparate(
				pass.alpha_blend_a === GsColorParam.RgbSource ? alpha : (pass.alpha_blend_b === GsColorParam.RgbSource ? one_minus_alpha : gl.ZERO),
				pass.alpha_blend_a === GsColorParam.RgbDest ? alpha : (pass.alpha_blend_b === GsColorParam.RgbDest ? one_minus_alpha : gl.ZERO),
				gl.ONE, gl.ZERO
			);
			gl.blendEquation(gl.FUNC_ADD);
		} else if(pass.alpha_blend_b === GsColorParam.Zero && pass.alpha_blend_a !== pass.alpha_blend_d) {
			// becomes (a - 0) * c + d => a*c + d*1
			gl.blendFuncSeparate(
				pass.alpha_blend_a === GsColorParam.RgbSource ? alpha : (pass.alpha_blend_d === GsColorParam.RgbSource ? gl.ONE : gl.ZERO),
				pass.alpha_blend_a === GsColorParam.RgbDest ? alpha : (pass.alpha_blend_d === GsColorParam.RgbDest ? gl.ONE : gl.ZERO),
				gl.ONE, gl.ZERO
			);
			gl.blendEquation(gl.FUNC_ADD);
		} else if(pass.alpha_blend_a === GsColorParam.Zero) {
			// becomes (0 - b) * c + d => d*1 - b*c
			gl.blendFuncSeparate(
				pass.alpha_blend_b === GsColorParam.RgbSource ? alpha : (pass.alpha_blend_d === GsColorParam.RgbSource ? gl.ONE : gl.ZERO),
				pass.alpha_blend_b === GsColorParam.RgbDest ? alpha : (pass.alpha_blend_d === GsColorParam.RgbDest ? gl.ONE : gl.ZERO),
				gl.ONE, gl.ZERO
			);
			gl.blendEquationSeparate(
				pass.alpha_blend_b === GsColorParam.RgbSource ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_SUBTRACT,
				gl.FUNC_ADD
			);
		} else if(pass.alpha_blend_d === GsColorParam.Zero) {
			// becomes (a - b) * c => a*c - b*c
			gl.blendFuncSeparate(alpha, alpha, gl.ONE, gl.ZERO);
			gl.blendEquationSeparate(
				pass.alpha_blend_b === GsColorParam.RgbSource ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_SUBTRACT,
				gl.FUNC_ADD
			);
		} else {
			gl.blendFunc(gl.ONE, gl.ZERO);
			gl.blendEquation(gl.FUNC_ADD);
			console.log("incompatible equation");
			return false;
		}
	}
	return true;
}