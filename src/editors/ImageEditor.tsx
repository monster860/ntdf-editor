import { Alert, Box, Button, ButtonGroup, Card, CardActions, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItem, ListItemButton, ListItemIcon, ListItemText, Switch, TextField } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from '@mui/icons-material/Edit';
import { fileOpen } from "browser-fs-access";
import { Gamefile, Chunk, ChunkType, ImageChunk, ImageLocation, MaterialsChunk, generate_rgba_palette, swizzle_32, swizzle_4, swizzle_8, deswizzle_32, deswizzle_4, deswizzle_8 } from "ntdf-modding-toolkit";
import { GsStorageFormat } from "ntdf-modding-toolkit/build/ps2/gs_constants";
import { useMemo, useState, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { AppCallbacks } from "../App";
import { useAsyncMemo } from "../async_memo";
import { GamefilePath, GamefilePathChunk, GamefilePathChunkBlob } from "../path";
import { ImageViewer, ImageViewerIndexed } from "./ImageViewer";
import { LocationControl } from "./LocationControl";

const zero_clut : ImageLocation = {location: 0, format: GsStorageFormat.PSMCT32, width: 16, height: 16, is_clut: true};

type LocationDialogState = ImageLocation & {
	open: boolean,
	edit_index: number|undefined,
	update_material: boolean,
	update_data: boolean
};

const vis_palette = new Uint8Array([
	0x00, 0x00, 0x00, 0x00,
	0x00, 0x80, 0x00, 0xFF,
	0x00, 0x80, 0x80, 0xFF,
	0x00, 0x00, 0x80, 0xFF,
	0xFF, 0x00, 0x00, 0xFF,
	0xFF, 0x80, 0x00, 0xFF,
	0xFF, 0x80, 0x80, 0xFF,
	0xFF, 0x00, 0x80, 0xFF,
]);

export function ImageEditor(props : {
	image : ImageChunk,
	path : GamefilePath<Chunk>,
	gamefile : Gamefile,
	callbacks : AppCallbacks
}) {
	let [[loc, clut_loc], set_loc] = useState(() => {
		let image_locs = props.image.locations.filter(l => !l.is_clut);
		let l = image_locs.length === 1 ? props.image.locations.indexOf(image_locs[0]) : -1;
		image_locs = props.image.locations.filter(l => l.is_clut);
		let cl = image_locs.length === 1 ? props.image.locations.indexOf(image_locs[0]) : -1;
		return [l,cl];
	});
	let [edit, set_edit] = useState<LocationDialogState>({
		location: 0,
		width: 16, height: 16,
		format: GsStorageFormat.PSMCT32,
		is_clut: true,
		open: false,
		edit_index: undefined,
		update_data: false,
		update_material: true
	});

	let async_memo_key = useMemo(() => [props.path, props.gamefile] as const, [props.path, props.gamefile]);
	let image_index = (props.path instanceof GamefilePathChunk) ? props.path.index : 0;
	let [materials] = useAsyncMemo(async ([path, gamefile]) => {
		if(!(path instanceof GamefilePathChunk)) return undefined;
		let chunk_file = await path.parent.resolve(gamefile);
		let materials_chunk = (await chunk_file.get_chunks_of_type(ChunkType.Materials))[0];
		if(materials_chunk) return await MaterialsChunk.from_blob(materials_chunk.contents);
	}, async_memo_key);

	let [data, current_location] = useMemo(() => {
		let clut_location : ImageLocation|undefined = props.image.locations[clut_loc];
		if(!clut_location?.is_clut) clut_location = undefined;
		let location : ImageLocation|undefined = props.image.locations[loc];
		if(location?.is_clut) location = undefined;
		if(!location) {
			if(clut_location && clut_location.height === 2) {
				location = {format: GsStorageFormat.PSMT4, width: props.image.width*2, height: props.image.height*4, location: 0, is_clut: false};
			} else if(clut_location && clut_location.height === 16) {
				location = {format: GsStorageFormat.PSMT8, width: props.image.width*2, height: props.image.height*2, location: 0, is_clut: false};
			} else {
				location = {format: GsStorageFormat.PSMCT32, width: props.image.width, height: props.image.height, location: 0, is_clut: false};
			}
		}
		return [props.image.export_data(location, false, true), location];
	}, [loc, clut_loc, props.image])
	let [clut_data, clut_location] = useMemo(() => {
		let location = props.image.locations[clut_loc];
		if(!location || !location.is_clut) return [undefined,undefined];
		return [props.image.export_data(location, false, true), location];
	}, [props.image, clut_loc])

	let vis_base_data = useMemo(() => {
		let chunk = new ImageChunk(props.image.width, props.image.height);
		for(let [index, location] of props.image.locations.entries()) {
			if(index === edit.edit_index) continue;
			let extract = chunk.export_data(location, false, false);
			let type_index = 3;
			if(location.format === GsStorageFormat.PSMT4) type_index = 1;
			else if(location.format === GsStorageFormat.PSMT8) type_index = 2;
			type_index |= type_index << 4;
			type_index |= type_index << 8;
			type_index |= type_index << 16;

			for(let i = 0; i < extract.length; i++) {
				extract[i] |= type_index;
			}
			chunk.import_data(location, extract, false, false);
		}
		return chunk.data;
	}, [props.image, edit.edit_index]);

	let [vis_data, vis_width, vis_height, vis_oob, vis_overlap] = useMemo(() => {
		let chunk = new ImageChunk(props.image.width, props.image.height, [], vis_base_data.slice());
		let edit_location = {
			location: edit.location,
			is_clut: false,
			width: edit.width,
			height: edit.height,
			format: edit.format
		};

		let extract = chunk.export_data(edit_location, false, false);
		for(let i = 0; i < extract.length; i++) {
			extract[i] |= 0x44;
		}
		chunk.import_data(edit_location, extract, false, false);
		extract = chunk.export_data(edit_location, false, false);
		let is_oob = false;
		let overlaps = false;
		for(let i = 0; i < extract.length; i++) {
			if(!(extract[i] & 4)) is_oob = true;
			else if((extract[i] & 0xF) !== 4) overlaps = true;
		}

		let data : Uint8Array;
		let location : ImageLocation;
		if(edit.format === GsStorageFormat.PSMT4) {
			location = {format: GsStorageFormat.PSMT4, width: props.image.width*2, height: props.image.height*4, location: 0, is_clut: false};
			data = chunk.export_data(location);
		} else if(edit.format === GsStorageFormat.PSMT8) {
			location = {format: GsStorageFormat.PSMT8, width: props.image.width*2, height: props.image.height*2, location: 0, is_clut: false};
			data = chunk.export_data(location);
			for(let i = 0; i < data.length; i++) {
				data[i] = (data[i] | (data[i] >> 4)) & 0xF;
			}
		} else {
			location = {format: GsStorageFormat.PSMCT32, width: props.image.width, height: props.image.height, location: 0, is_clut: false};
			let data_32 = chunk.export_data(location, false, false);
			data = new Uint8Array(data_32.length>>2);
			for(let i = 0; i < data.length; i++) {
				let i32 = i<<2;
				let val = data_32[i32] | data_32[i32+1] | data_32[i32+2] | data_32[i32+3];
				data[i] = (val | (val>>4)) & 0xF;
			}
		}

		return [data, location.width, location.height, is_oob, overlaps];
	}, [props.image, vis_base_data, edit.location, edit.format, edit.width, edit.height]);

	let infer_clut_location = (loc : number, orig : number = -1) => {
		if(loc === -1) return orig;
		let location = props.image.locations[loc];
		if(!location || location.is_clut) return orig;
		if(location.format === GsStorageFormat.PSMCT32) return -1;
		let orig_clut : ImageLocation|undefined = props.image.locations[orig];
		if(orig_clut && !orig_clut.is_clut) orig_clut = undefined;

		if(materials) {
			for(let mat of materials.materials) {
				if(mat.texture_file !== image_index) continue;
				for(let pass of mat.passes) {
					if(pass.texture_location.includes(location.location)) {
						for(let i = 0; i < props.image.locations.length; i++) {
							let candidate = props.image.locations[i];
							if(candidate.is_clut && candidate.location === pass.clut_location) return i;
						}
					}
				}
			}
		}

		if(location.format === GsStorageFormat.PSMT4) {
			let locations = props.image.locations.filter(l => l.format === GsStorageFormat.PSMT4);
			let clut_locations = props.image.locations.filter(l => l.is_clut && l.height === 2);
			let clut_index = props.image.locations.indexOf(clut_locations[locations.indexOf(location)]);
			if(locations.length === clut_locations.length && clut_index >= 0) return clut_index;
			return orig_clut?.height === 2 ? orig : -1;
		} else if(location.format === GsStorageFormat.PSMT8) {
			let clut_locations = props.image.locations.filter(l => l.is_clut && l.height === 16);
			if(clut_locations.length === 1) {
				return props.image.locations.indexOf(clut_locations[0]);
			}
			return orig_clut?.height === 16 ? orig : -1;
		}
		return orig;
	}

	let virtuoso = useRef<VirtuosoHandle>(null);
	let box_ref = useRef<HTMLElement|undefined>();

	let handle_keydown = (event : React.KeyboardEvent) => {
		if(edit.open) return;
		if(event.code === "ArrowUp" || event.code === "ArrowDown") {
			event.preventDefault();
			(document.activeElement as HTMLElement|null)?.blur?.();
			box_ref.current?.focus();
			let adj = event.code === "ArrowDown" ? 1 : -1;
			set_loc(([l, cl]) => {
				let image_locs = props.image.locations.filter(l => !l.is_clut);
				let index = adj + image_locs.indexOf(props.image.locations[l]);
				if(index < 0) index = image_locs.length-1;
				else if(index >= image_locs.length) index = 0;
				let loc = props.image.locations.indexOf(image_locs[index]);
				virtuoso.current?.scrollIntoView({index: loc});
				return [loc, infer_clut_location(loc, cl)];
			})
		} else if(event.code === "ArrowLeft" || event.code === "ArrowRight") {
			event.preventDefault();
			(document.activeElement as HTMLElement|null)?.blur?.();
			box_ref.current?.focus();
			let adj = event.code === "ArrowRight" ? 1 : -1;
			set_loc(([l, cl]) => {
				let location = props.image.locations[l];
				let image_locs : ImageLocation[];
				if(location?.format === GsStorageFormat.PSMT4) image_locs = props.image.locations.filter(l => l.is_clut && l.height === 2);
				else if(location?.format === GsStorageFormat.PSMT8) image_locs = props.image.locations.filter(l => l.is_clut && l.height === 16);
				else image_locs = props.image.locations.filter(l => l.is_clut);
				let index = adj + image_locs.indexOf(props.image.locations[cl]);
				if(index < 0) index = image_locs.length-1;
				else if(index >= image_locs.length) index = 0;
				let loc = props.image.locations.indexOf(image_locs[index]);
				virtuoso.current?.scrollIntoView({index: loc});
				return [l, loc];
			})
		} else if(event.code === "Escape") {
			event.preventDefault();
			(document.activeElement as HTMLElement|null)?.blur?.();
			box_ref.current?.focus();
			set_loc(([l, cl]) => [-1, l === -1 ? -1 : cl]);
		}
	}

	let handle_canvas_click = (e:React.MouseEvent) => {
		if(loc >= 0) return;
		let canvas = e.target as HTMLElement;
		let rect = canvas.getBoundingClientRect();
		let x = Math.round((e.clientX - rect.x) / rect.width * current_location.width);
		let y = Math.round((e.clientY - rect.y) / rect.height * current_location.height);
		let location = 0;
		if(current_location.format === GsStorageFormat.PSMT4) {
			x = (x >> 5) << 5;
			y = (y >> 4) << 4;
			location = (swizzle_4(x, y, props.image.width*2/64) / 512)|0;
		} else if(current_location.format === GsStorageFormat.PSMT8) {
			x = (x >> 4) << 4;
			y = (y >> 4) << 4;
			location = (swizzle_8(x, y, props.image.width*2/64) / 256)|0;
		} else {
			x = (x >> 3) << 3;
			y = (y >> 3) << 3;
			location = (swizzle_32(x, y, props.image.width/64) / 64)|0;
		}
		for(let [index, compare] of props.image.locations.entries()) {
			let cx=0, cy=0, ox=0, oy=0;
			if(compare.format === GsStorageFormat.PSMT4) {
				[cx,cy] = deswizzle_4(compare.location*512, props.image.width*2/64);
				[ox,oy] = deswizzle_4((location*512)|0, props.image.width*2/64);
			} else if(compare.format === GsStorageFormat.PSMT8) {
				[cx,cy] = deswizzle_8(compare.location*256, props.image.width*2/64);
				[ox,oy] = deswizzle_8((location*256)|0, props.image.width*2/64);
			} else {
				[cx,cy] = deswizzle_32(compare.location*64, props.image.width*2/64);
				[ox,oy] = deswizzle_32((location*64)|0, props.image.width*2/64);
			}
			if(ox >= cx && oy >= cy && ox < cx+compare.width && oy < cy+compare.height) {
				if(!compare.is_clut) {
					set_loc(([l, cl]) => ([index, infer_clut_location(index, cl)]));
				} else {
					set_loc([-1, index]);
				}
				e.preventDefault();
				(document.activeElement as HTMLElement|null)?.blur?.();
				box_ref.current?.focus();
				virtuoso.current?.scrollIntoView({index});
				return;
			}
		}
		set_edit(state => ({
			...state,
			open: true,
			format: current_location.format,
			is_clut: false,
			location,
			width: 8,
			height: 8,
			edit_index: undefined
		}));
	}

	let imageRendering : "pixelated"|undefined = Math.min(current_location.width, current_location.height) >= 64 ? undefined : "pixelated";

	return (
		<Box sx={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}} onKeyDown={handle_keydown} tabIndex={0}><Box sx={{display: "flex", flexDirection: "row", flexShrink: 1, position: 'absolute', width:'100%', height:'100%'}}>
			<Virtuoso
				ref={virtuoso}
				scrollerRef={(e => {if(e instanceof HTMLElement) box_ref.current = e;})}
				data={props.image.locations}
				style={{height: '100%', minWidth: 350}}
				itemContent={(index, data) => {
					return (
						<ListItem dense disablePadding secondaryAction={
							<IconButton onClick={() => {
								set_edit(state => ({...state,
									...data,
									open: true,
									edit_index: index
								}));
							}}><EditIcon /></IconButton>
						}>
							<ListItemButton selected={data.is_clut ? clut_loc === index : loc === index} onClick={() => {
								if(data.is_clut) {
									set_loc(([l, cl]) => (cl === index ? [l, -1] : [l, index]));
								} else {
									set_loc(([l,cl]) => {
										if(l === index) return [-1,cl];
										return [index,infer_clut_location(index, cl)];
									});
								}
							}}>
								<ListItemText>
									{data.location} ({data.width}x{data.height}) - {GsStorageFormat[data.format]}{data.is_clut ? " (CLUT)" : ""}
								</ListItemText>
							</ListItemButton>
						</ListItem>
					);
				}}
				components={{
					Footer: () => {
						return (
							<ListItem dense disablePadding>
								<ListItemButton onClick={() => {
									set_edit(state => ({...state, open: true, edit_index: undefined}));
								}}>
									<ListItemIcon>
										<AddIcon />
									</ListItemIcon>
									<ListItemText>
										Add
									</ListItemText>
								</ListItemButton>
							</ListItem>
						)
					}
				}}
			/>
			<Box sx={{flexGrow: 1, height: '100%', overflow: 'auto'}}>
				{current_location.format === GsStorageFormat.PSMCT32 ? <ImageViewer 
					data={data}
					width={current_location.width}
					height={current_location.height}
					style={current_location.width > current_location.height ? {minWidth: '70%', imageRendering} : {minHeight: '60%', imageRendering}}
					onClick={handle_canvas_click}
				/> : <ImageViewerIndexed 
					data={data}
					clut_data={clut_data}
					width={current_location.width}
					height={current_location.height}
					is_4_bit={current_location.format === GsStorageFormat.PSMT4}
					style={current_location.width > current_location.height ? {minWidth: '70%', imageRendering} : {minHeight: '60%', imageRendering}}
					onClick={handle_canvas_click}
				/>}
				<Card sx={{maxWidth: 600}}>
					<CardActions>
						{clut_location && <Button onClick={async () => {
							if(!clut_location) return;
							let files = await fileOpen({
								multiple: true,
								mimeTypes: ["image/png"],
								extensions: [".png"]
							});
							let palette : Uint8Array;
							try {
								if(!files.length) return;
								let datas : Uint8Array[] = (await Promise.all(files.map(f => blob_to_imagedata(f)))).filter((a):a is ImageData => (a instanceof ImageData)).map(a => new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.length));
								if(!datas.length) return;
								palette = generate_rgba_palette(datas, clut_location.height === 16 ? 8 : 4, false);
							} catch(e) {
								props.callbacks.show_error(e);
								return;
							}

							props.callbacks.edit_gamefile(async gamefile => {
								let path = new GamefilePathChunkBlob(props.path);
								let chunk_blob = await path.resolve(gamefile);
								let image_chunk = await ImageChunk.from_blob(chunk_blob);
								if(!clut_location) return null;
								image_chunk.import_data(clut_location, palette, false, true);
								return await path.replace(gamefile, image_chunk.to_blob());
							});

						}}>Generate Palette</Button>}
						{(clut_location || current_location.format === GsStorageFormat.PSMCT32) && loc>=0 && <Button onClick={async () => {
							let file = await fileOpen({
								mimeTypes: ["image/png"],
								extensions: [".png"]
							});
							let data = (await blob_to_imagedata(file, current_location.width, current_location.height))?.data;
							if(!data) return;
							let unclamped_data = new Uint8Array(data.buffer, data.byteOffset, data.length);
							
							props.callbacks.edit_gamefile(async gamefile => {
								let path = new GamefilePathChunkBlob(props.path);
								let chunk_blob = await path.resolve(gamefile);
								let image_chunk = await ImageChunk.from_blob(chunk_blob);
								image_chunk.import_indexed_data(current_location, unclamped_data, clut_location ?? zero_clut, false, true);
								return await path.replace(gamefile, image_chunk.to_blob());
							})
						}}>Import Image</Button>}
					</CardActions>
				</Card>
			</Box>
			<Dialog open={edit.open} onClose={() => {set_edit(state => ({...state, open: false}));}}>
				<DialogTitle>{edit.edit_index !== undefined ? "Edit" : "Add"} Location</DialogTitle>
				<DialogContent>
					<ButtonGroup>
						<Button variant={(edit.format === GsStorageFormat.PSMT4) ? "contained":undefined} onClick={() => {
							set_edit(state => ({...state, format: GsStorageFormat.PSMT4, is_clut: false}));
						}}>PSMT4</Button>
						<Button variant={(edit.format === GsStorageFormat.PSMT8) ? "contained":undefined} onClick={() => {
							set_edit(state => ({...state, format: GsStorageFormat.PSMT8, is_clut: false}));
						}}>PSMT8</Button>
						<Button variant={(edit.format === GsStorageFormat.PSMCT32 && edit.is_clut) ? "contained":undefined} onClick={() => {
							set_edit(state => ({...state, format: GsStorageFormat.PSMCT32, is_clut: true, width: state.width === 8 ? 8 : 16, height: state.width === 8 ? 2 : 16}));
						}}>PSMCT32 (CLUT)</Button>
						<Button variant={(edit.format === GsStorageFormat.PSMCT32 && !edit.is_clut) ? "contained":undefined} onClick={() => {
							set_edit(state => ({...state, format: GsStorageFormat.PSMCT32, is_clut: false}));
						}}>PSMCT32</Button>
					</ButtonGroup>
					{!edit.is_clut && <Box>
						<TextField
							margin="dense"
							type="number"
							label="Width"
							value={edit.width}
							onChange = {e => {
								set_edit(state => ({...state, width: +e.target.value}));
							}}
							inputProps={{min: 1, max: 256}}
						/>
						<TextField
							margin="dense"
							type="number"
							label="Height"
							value={edit.height}
							onChange = {e => {
								set_edit(state => ({...state, height: +e.target.value}));
							}}
							inputProps={{min: 1, max: 256}}
						/>
					</Box>}
					{edit.is_clut && <Box sx={{mt: 2, mb: 2}}><ButtonGroup>
						<Button
							variant={edit.width === 8 ? "contained":undefined}
							onClick={() => {
								set_edit(state => ({...state, width: 8, height: 2}));
							}}
						>8 x 2 (for PSMT4)</Button>
						<Button
							variant={edit.width !== 8 ? "contained":undefined}
							onClick={() => {
								set_edit(state => ({...state, width: 16, height: 16}));
							}}
						>16 x 16 (for PSMT8)</Button>
					</ButtonGroup></Box>}
					<LocationControl
						width32={props.image.width}
						format={edit.format}
						height32={props.image.height}
						location={edit.location}
						set_location={location => {
							set_edit(state => ({...state, location}));
						}}
					/>
					{<Alert severity="warning" sx={{visibility: (vis_oob || vis_overlap) ? undefined:"hidden"}}>
						Location{vis_oob && " is partially out of bounds"}
						{vis_oob && vis_overlap && " and"}
						{vis_overlap && " intersects other locations"}
					</Alert>}
					<Box sx={{height: '40vh', width: 500}}>
						<ImageViewerIndexed 
							data={vis_data}
							is_4_bit
							clut_data={vis_palette}
							width={vis_width}
							height={vis_height}
							style={{maxHeight: '40vh', maxWidth: 500}}
						/>
					</Box>
					<Box>
						<FormControlLabel control={<Switch value={edit.update_data} onChange={e => set_edit(state => ({...state, update_data: e.target.checked}))}/>} label="Move Data" />
						{materials !== undefined && <FormControlLabel control={<Switch value={edit.update_material} onChange={e => set_edit(state => ({...state, update_material: e.target.checked}))} />} label="Update Materials" />}
					</Box>
				</DialogContent>
				<DialogActions>
					{edit.edit_index !== undefined && <Button onClick={() => {
						set_edit(state => ({...state, open: false}));
						props.callbacks.edit_gamefile(async gamefile => {
							if(edit.edit_index === undefined || edit.edit_index >= props.image.locations.length || edit.edit_index < 0) return null;
							let path = new GamefilePathChunkBlob(props.path);
							let chunk_blob = await path.resolve(gamefile);
							let image_chunk = await ImageChunk.from_blob(chunk_blob);
							image_chunk.locations.splice(edit.edit_index, 1);
							return await path.replace(gamefile, image_chunk.to_blob());
						})
					}} color="error">Delete</Button>}
					<Button onClick={() => {set_edit(state => ({...state, open: false}));}}>Cancel</Button>
					<Button onClick={() => {
						let location : ImageLocation = {
							format: edit.format,
							width: edit.width,
							height: edit.height,
							location: edit.location,
							is_clut: edit.is_clut
						};
						set_edit(state => ({...state, open: false}));
						props.callbacks.edit_gamefile(async gamefile => {
							let path = new GamefilePathChunkBlob(props.path);
							let chunk_blob = await path.resolve(gamefile);
							let image_chunk = await ImageChunk.from_blob(chunk_blob);
							let old_locations = [...image_chunk.locations];
							let data : Uint8Array|undefined = undefined;
							if(edit.edit_index !== undefined && edit.update_data) data = image_chunk.export_data(old_locations[edit.edit_index]);
							
							if(edit.edit_index !== undefined) image_chunk.locations[edit.edit_index] = location;
							else image_chunk.locations.push(location);
							
							if(data) image_chunk.import_data(location, data);
							
							gamefile = await path.replace(gamefile, image_chunk.to_blob());

							if(edit.edit_index !== undefined && materials && edit.update_material && (props.path instanceof GamefilePathChunk)) {
								let materials_path = new GamefilePathChunkBlob(new GamefilePathChunk(props.path.parent, ChunkType.Materials, 0, 0));
								let materials = await MaterialsChunk.from_blob(await materials_path.resolve(gamefile));
								for(let material of materials.materials) {
									if(material.texture_file !== props.path.index) {
										continue;
									}
									for(let pass of material.passes) {
										for(let i = 0; i < pass.texture_location.length; i++) {
											if(pass.texture_location[i] === old_locations[edit.edit_index].location && !location.is_clut) {
												pass.texture_location[i] = location.location;
												if(i === 0) {
													let width_adj = pass.texture_log_width - Math.ceil(Math.log2(old_locations[edit.edit_index].width));
													let height_adj = pass.texture_log_height - Math.ceil(Math.log2(old_locations[edit.edit_index].height));
													pass.texture_log_width = width_adj + Math.ceil(Math.log2(location.width));
													pass.texture_log_height = height_adj + Math.ceil(Math.log2(location.height));
													pass.texture_format = location.format;
													pass.texture_buffer_width = location.format === GsStorageFormat.PSMCT32 ? (props.image.width/64) : (props.image.width/64*2);
												}
											}
										}
										if(pass.texture_format !== GsStorageFormat.PSMCT32 && pass.clut_location === old_locations[edit.edit_index].location && location.is_clut) {
											pass.clut_location = location.location;
										}
									}
								}
								gamefile = await materials_path.replace(gamefile, materials.to_blob());
							}

							return gamefile;
						})
					}}>{edit.edit_index !== undefined ? "Edit" : "Add"}</Button>
				</DialogActions>
			</Dialog>
		</Box></Box>
	)
}

async function blob_to_imagedata(file : Blob, target_width? : number, target_height? : number) {
	let image = new Image();
	let url = URL.createObjectURL(file);
	image.src = url;
	try {
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = reject;
		});
	} finally {
		URL.revokeObjectURL(url);
	}

	let canvas = document.createElement("canvas");
	canvas.width = target_width ?? image.width;
	canvas.height = target_height ?? image.height;
	let ctx = canvas.getContext('2d');
	if(!ctx) return undefined;
	
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	let imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
	return imagedata;
}
