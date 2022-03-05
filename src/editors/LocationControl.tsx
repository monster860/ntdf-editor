import { Box, TextField } from "@mui/material";
import { deswizzle_32, deswizzle_4, deswizzle_8, GsStorageFormat, swizzle_32, swizzle_4, swizzle_8 } from "ntdf-modding-toolkit";
import React from "react";

type LocationControlProps = {
	location: number,
	width32: number,
	height32: number,
	format: GsStorageFormat,
	label?: string,
	set_location: (location : number) => void;
};
type LocationControlState = {
	location: number,
	width32: number,
	format : GsStorageFormat,
	x: number,
	y: number,
	is_error: boolean
};

export class LocationControl extends React.PureComponent<LocationControlProps,LocationControlState> {
	state : LocationControlState = {
		location: 0,
		width32: 256,
		format: GsStorageFormat.PSMCT32,
		x: 0,
		y: 0,
		is_error: false
	};
	static getDerivedStateFromProps(props : LocationControlProps, state : LocationControlState) {
		if(props.location !== state.location || props.format !== state.format || props.width32 !== state.width32) {
			let x:number, y:number;
			if(props.format === GsStorageFormat.PSMT8) {
				[x,y] = deswizzle_8(props.location*256, props.width32/64*2);
			} else if(props.format === GsStorageFormat.PSMT4) {
				[x,y] = deswizzle_4(props.location*512, props.width32/64*2);
			} else {
				[x,y] = deswizzle_32(props.location*64, props.width32/64);
			}
			return {
				...state,
				location: props.location,
				width32: props.width32,
				format: props.format,
				x,y,
				is_error: false
			};
		}
		return null;
	}
	set_location = (location : number) => {
		if(Number.isNaN(location)) return;
		location = location|0;
		this.props.set_location(location);
	}
	set_x = (x : number) => {
		if(Number.isNaN(x)) return;
		x = x|0;
		let location = this.location_from_xy(x, this.state.y);
		if(location !== undefined) this.set_location(location);
		else this.setState(state => ({
			...state,
			x,
			is_error: true
		}));
	};

	set_y = (y : number) => {
		if(Number.isNaN(y)) return;
		y = y|0;
		let location = this.location_from_xy(this.state.x, y);
		if(location !== undefined) this.set_location(location);
		else this.setState(state => ({
			...state,
			y,
			is_error: true
		}));
	};

	location_from_xy(x:number, y:number) : number|undefined {
		let location:number;
		if(this.props.format === GsStorageFormat.PSMT8) {
			location = swizzle_8(x, y, this.props.width32/64*2)/256;
		} else if(this.props.format === GsStorageFormat.PSMT4) {
			location = swizzle_4(x, y, this.props.width32/64*2)/512;
		} else {
			location = swizzle_32(x, y, this.props.width32/64)/64;
		}
		if(location === Math.floor(location)) return location;
		return undefined;
	}

	render() {
		let width_mult = 1;
		let height_mult = 1;
		let step_x = 8;
		let step_y = 8;
		if(this.props.format === GsStorageFormat.PSMT4) {
			width_mult = 2;
			height_mult = 4;
			step_x = 32;
			step_y = 16;
		} else if(this.props.format === GsStorageFormat.PSMT8) {
			width_mult = 2;
			height_mult = 2;
			step_x = 16;
			step_y = 16;
		}
		return (
			<Box>
				<TextField
					margin="dense"
					label={this.props.label ?? "Location"}
					type="number"
					value={this.props.location}
					inputProps={{min: 0, max: (this.props.width32 * this.props.height32 / 64)-1, step: 1}}
					onChange={e => {this.set_location(+e.target.value);}}
				/>
				<TextField
					margin="dense"
					label="x"
					type="number"
					value={this.state.x}
					error={this.state.is_error}
					inputProps={{min: 0, max: this.props.width32 * width_mult - step_x, step: step_x}}
					onChange={e => {this.set_x(+e.target.value);}}
				/>
				<TextField
					margin="dense"
					label="y"
					type="number"
					value={this.state.y}
					error={this.state.is_error}
					inputProps={{min: 0, max: this.props.height32 * height_mult - step_y, step: step_y}}
					onChange={e => {this.set_y(+e.target.value);}}
				/>
			</Box>
		)
	}
}