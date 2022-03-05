import { GsStorageFormat, ImageChunk, ImageLocation } from "ntdf-modding-toolkit";
import React, { useEffect, useMemo, useState } from "react";
import { useAsyncMemo } from "../async_memo";

export function ImageLocationViewer(props : React.HTMLAttributes<HTMLCanvasElement> & {
	image : ImageChunk|undefined,
	location : ImageLocation|undefined,
	clut_location : ImageLocation|undefined
}) {
	let {image, location, clut_location, ...canvas_props} = props;
	let [data] = useAsyncMemo(async () => {
		if(image && location) {
			if(clut_location) {
				return image.export_indexed_data(location, clut_location, false, true);
			} else if(location.format === GsStorageFormat.PSMCT32) {
				return image.export_data(location, false, true);
			}
		}
		return undefined;
	}, useMemo(()=>[image,location,clut_location], [image,location,clut_location]))

	return (
		<ImageViewer
			data={data ?? default_data}
			width={location?.width ?? 1}
			height={location?.height ?? 1}
			{...canvas_props}
		/>
	)
}
const default_data = new Uint8Array(4);

const default_canvas = document.createElement("canvas");
default_canvas.width = 1; default_canvas.height = 1;
const default_url = default_canvas.toDataURL();

export function ImageLocationUrl(props : {
	image : ImageChunk|undefined,
	location: ImageLocation|undefined,
	clut_location : ImageLocation|undefined,
	children: (url:string) => React.ReactElement
}) {
	let {image, location, clut_location} = props;
	let location_str = location?JSON.stringify(location):undefined;
	let clut_location_str = clut_location?JSON.stringify(clut_location):undefined;
	let [blob] = useAsyncMemo(async () => {
		console.log(location_str);
		let location = location_str?JSON.parse(location_str):undefined;
		let clut_location = clut_location_str?JSON.parse(clut_location_str):undefined;
		if(image && location) {
			let data : Uint8Array;
			if(clut_location) {
				data = image.export_indexed_data(location, clut_location, false, true);
			} else if(location.format === GsStorageFormat.PSMCT32) {
				data = image.export_data(location, false, true);
			} else {
				return undefined;
			}

			let canvas = document.createElement("canvas");
			let image_data = new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), location.width, location.height);
			canvas.width = location.width;
			canvas.height = location.height;
			let ctx = canvas.getContext('2d');
			if(!ctx) return undefined;
			ctx.clearRect(0, 0, location.width, location.height);
			ctx.putImageData(image_data, 0, 0);
			return await new Promise<Blob|null>(resolve => canvas.toBlob(resolve)) ?? undefined;
		}
		return undefined;
	}, useMemo(()=>[image,location_str,clut_location_str], [image,location_str,clut_location_str]));
	let [url, set_url] = useState(default_url);
	useEffect(() => {
		if(blob) {
			let our_url = URL.createObjectURL(blob);
			set_url(our_url);
			return () => {
				URL.revokeObjectURL(our_url);
			}
		} else {
			set_url(default_url);
		}
	}, [blob]);
	return props.children(url);
}

export function ImageViewer(props : React.HTMLAttributes<HTMLCanvasElement> & {
	data : Uint8Array,
	width : number,
	height : number,
}) {
	let [canvas, set_canvas] = useState<HTMLCanvasElement|null>(null);
	useEffect(() => {
		if(!canvas) return;
		let image_data = new ImageData(new Uint8ClampedArray(props.data.buffer, props.data.byteOffset, props.data.length), props.width, props.height);
		canvas.width = props.width;
		canvas.height = props.height;
		let ctx = canvas.getContext('2d');
		if(!ctx) return;
		ctx.clearRect(0, 0, props.width, props.height);
		ctx.putImageData(image_data, 0, 0);
	}, [canvas, props.data, props.width, props.height]);
	return (<canvas ref={c => {set_canvas(c);}} {...{...props, data: undefined}} />);
}

export function ImageViewerIndexed(props : React.HTMLAttributes<HTMLCanvasElement> & {
	data : Uint8Array,
	clut_data? : Uint8Array,
	is_4_bit? : boolean,
	width : number,
	height : number,
}) {
	let [canvas, set_canvas] = useState<HTMLCanvasElement|null>(null);
	useEffect(() => {
		if(!canvas) return;
		let image_data = new ImageData(props.width, props.height);
		for(let i = 0; i < image_data.data.length; i += 4) {
			let index = props.data[i >> 2];
			if(props.clut_data) {
				let index_shifted = index << 2;
				image_data.data[i+0] = props.clut_data[index_shifted+0];
				image_data.data[i+1] = props.clut_data[index_shifted+1];
				image_data.data[i+2] = props.clut_data[index_shifted+2];
				image_data.data[i+3] = props.clut_data[index_shifted+3];
			} else {
				let greyscale_value = props.is_4_bit ? index*17 : index;
				image_data.data[i+0] = greyscale_value;
				image_data.data[i+1] = greyscale_value;
				image_data.data[i+2] = greyscale_value;
				image_data.data[i+3] = 255;
			}
		}
		canvas.width = props.width;
		canvas.height = props.height;
		let ctx = canvas.getContext('2d');
		if(!ctx) return;
		ctx.clearRect(0, 0, props.width, props.height);
		ctx.putImageData(image_data, 0, 0);
	}, [canvas, props.data, props.clut_data, props.is_4_bit, props.width, props.height]);
	return (<canvas ref={c => {set_canvas(c);}} {...{...props, data: undefined, clut_data: undefined, is_4_bit: undefined}} />);
}