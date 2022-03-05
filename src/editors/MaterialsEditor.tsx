import { Box, ListItem, ListItemButton, ListItemText, ListItemIcon, Avatar, ListItemAvatar, Accordion, AccordionDetails, AccordionSummary, Typography, Button, ButtonGroup, Menu, MenuItem, FormControlLabel, Slider, Alert, Switch, IconButton } from "@mui/material";
import { Chunk, ChunkType, Gamefile, GsAlphaFailMethod, GsAlphaParam, GsAlphaTestMethod, GsColorParam, GsDepthTestMethod, GsFilter, GsStorageFormat, GsWrapMode, ImageChunk, Material, MaterialPass, MaterialsChunk, ShaderType } from "ntdf-modding-toolkit";
import { ReactElement, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { AppCallbacks } from "../App";
import { useAsyncMemo } from "../async_memo";
import { GamefilePath, GamefilePathBlobSlice, GamefilePathChunk, GamefilePathChunkBlob } from "../path";
import AddIcon from "@mui/icons-material/Add"
import { ImageLocationUrl } from "./ImageViewer";
import { ModelViewer } from "./model_viewer/ModelViewer";
import { ExpandMore, Remove } from "@mui/icons-material";
import object_key from "../object_key";

export function MaterialsEditor(props : {
	materials : MaterialsChunk,
	path : GamefilePath<Chunk>,
	gamefile : Gamefile,
	callbacks : AppCallbacks,
	visible: boolean
}) {
	const [images] = useAsyncMemo(async ([gamefile, path]) => {
		if(!(path instanceof GamefilePathChunk)) return undefined;
		let chunk_file = await path.parent.resolve(gamefile);
		let images = await Promise.all(chunk_file.get_chunks_of_type(ChunkType.Image).map(a => ImageChunk.from_blob(a.contents)));
		return images;
	}, useMemo(() => [props.gamefile, props.path] as const, [props.gamefile, props.path]));
	const [selected, set_selected] = useState(-1);
	const selected_material:Material|undefined = props.materials.materials[selected];
	const blob_path = new GamefilePathChunkBlob(props.path);

	return (
		<Box sx={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}} tabIndex={0}><Box sx={{display: "flex", flexDirection: "row", flexShrink: 1, position: 'absolute', width:'100%', height:'100%'}}>
			<Virtuoso
				data={props.materials.materials}
				style={{height: '100%', minWidth: 350}}
				itemContent={(index, data) => {
					
					return (
						<ListItem disablePadding>
							<ListItemButton selected={selected === index} onClick={() => {
								set_selected(index);
							}}>
								<ListItemAvatar>
									<ImageLocationUrl
										image={images?.[data.texture_file]}
										location={{
											location: data.passes[0].texture_location[0],
											format: data.passes[0].texture_format,
											width: 1<<data.passes[0].texture_log_width,
											height: 1<<data.passes[0].texture_log_height,
											is_clut: false
										}}
										clut_location={{
											location: data.passes[0].clut_location,
											format: GsStorageFormat.PSMCT32,
											width: 16,
											height: 16,
											is_clut: true
										}}
									>
										{(url) => (
											<Avatar src={url} />
										)}
									</ImageLocationUrl>
								</ListItemAvatar>
								<ListItemText>
									Material {index}
								</ListItemText>
							</ListItemButton>
						</ListItem>
					);
				}}
				components={{
					Footer: () => {
						return (
							<ListItem disablePadding>
								<ListItemButton onClick={() => {
									props.callbacks.edit_gamefile(async gamefile => {
										let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
										let mat = new Material();
										mat.passes.push(new MaterialPass());
										materials.materials.push(mat);
										return blob_path.replace(gamefile, materials.to_blob());
									})
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
				{images && images.length !== props.materials.num_texture_files && <Alert severity="warning">
					The number of image files in this context does not match the amount specified by this materials file.
					<div><Button onClick={() => {
						
					}}>Fix now</Button></div>
				</Alert>}
				{images && selected_material && <>
					<Accordion defaultExpanded>
						<AccordionSummary expandIcon={<ExpandMore />}>
							<Typography>Preview</Typography>
						</AccordionSummary>
						<AccordionDetails>
							<ModelViewer
								visible={props.visible}
								materials={props.materials}
								images={images}
								preview_material_index={selected}
								container_props={{
									width: 512 * Math.min(1, (1 << selected_material.passes[0].texture_log_width) / (1 << selected_material.passes[0].texture_log_height)),
									height: 512 * Math.min(1, (1 << selected_material.passes[0].texture_log_height) / (1 << selected_material.passes[0].texture_log_width)),
									style: {position: "relative"}
								}}
								show_view_options={false}
							/>
						</AccordionDetails>
					</Accordion>
					<Accordion>
						<AccordionSummary expandIcon={<ExpandMore />}>
							<Typography>Properties</Typography>
						</AccordionSummary>
						<AccordionDetails>
							<Box>
								<Box sx={{my: 1}}><Button onClick={() => {
									props.callbacks.open_file(new GamefilePathBlobSlice(blob_path, 0x20 + 0x270*selected, 0x20 + 0x270*(selected+1)));
								}}>Open in hex editor</Button></Box>
								<Box sx={{my: 1}}><ButtonGroup>
									{[-1, ...images.keys()].map(i => (
										<Button
											key={i}
											variant={selected_material?.texture_file === i ? "contained" : "outlined"}
											onClick={() => {
												props.callbacks.edit_gamefile(async gamefile => {
													let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
													materials.materials[selected].texture_file = i;
													return blob_path.replace(gamefile, materials.to_blob());
												})
											}}
										>{i === -1 ? "None" : ("Image "+i)}</Button>
									))}
								</ButtonGroup></Box>
								<Box sx={{my: 1}}><ButtonGroup>
									{Object.values(ShaderType).map(a => {
										if(typeof a === "number") {
											return <Button
												key={a}
												variant={selected_material?.passes[0].shader_type === a ? "contained" : "outlined"}
												onClick={() => {
													props.callbacks.edit_gamefile(async gamefile => {
														let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
														for(let pass of materials.materials[selected].passes) {
															pass.shader_type = a;
														}
														return blob_path.replace(gamefile, materials.to_blob());
													})	
												}}
											>{ShaderType[a].replace(/([a-z])([A-Z])/g, (a,b,c) => `${b} ${c}`)}</Button>
										} else return undefined;
									})}
								</ButtonGroup></Box>
							</Box>
						</AccordionDetails>
					</Accordion>
					{selected_material.passes.map((pass, pass_index) => (<Accordion key={pass_index}>
						<AccordionSummary expandIcon={<ExpandMore />}>
							<Typography>Pass {pass_index+1}</Typography>
						</AccordionSummary>
						<AccordionDetails>
							<Typography sx={{display: 'block'}}>Blend equation</Typography>
							<Typography variant="h6">
								(<PassDropdown
									pass={pass} path={blob_path} pass_key="alpha_blend_a" mat_index={selected}
									pass_index={pass_index} enum={GsColorParam} callbacks={props.callbacks}
								/> - <PassDropdown
									pass={pass} path={blob_path} pass_key="alpha_blend_b" mat_index={selected}
									pass_index={pass_index} enum={GsColorParam} callbacks={props.callbacks}
								/>)&nbsp; &times; <PassDropdown
									pass={pass} path={blob_path} pass_key="alpha_blend_c" mat_index={selected}
									pass_index={pass_index} enum={GsAlphaParam} callbacks={props.callbacks}
								/> + <PassDropdown
									pass={pass} path={blob_path} pass_key="alpha_blend_d" mat_index={selected}
									pass_index={pass_index} enum={GsColorParam} callbacks={props.callbacks}
								/>
							</Typography>
							{pass.alpha_blend_c === GsAlphaParam.Fix && <>
								<Slider
									min={0} max={255} step={1}
									defaultValue={Math.round(pass.alpha_blend_value * 128)}
									key={[selected, object_key(props.materials), props.path, pass.alpha_blend_value, "alpha fixed"].join(",")}
									valueLabelFormat={v => (v / 128).toFixed(3)}
									valueLabelDisplay="auto"
									onChangeCommitted={(e, v) => {
										let val = v as number;
										if(val/128 === pass.alpha_blend_value) return;
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											pass.alpha_blend_value = val/128;
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}
								/>
							</>}
							{images && selected_material.texture_file >= 0 && selected_material.texture_file < images.length && <>
								<Typography sx={{display: 'block'}}>Texturing</Typography>
								<Box sx={{mh:1}}>
									{pass.texture_location.map((loc_num, mipmap_level) => (
										<Dropdown label={`${mipmap_level === 0 ? "Texture Location: " : `Mipmap ${mipmap_level}: `} ${loc_num}`}>
											{close => images[selected_material.texture_file].locations.map(location => {
												if(location.is_clut) return undefined;
												if(mipmap_level > 0 && location.format !== pass.texture_format) return undefined;
												return <MenuItem
													key={location.location}
													onClick={() => {
														props.callbacks.edit_gamefile(async gamefile => {
															let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
															let pass = materials.materials[selected].passes[pass_index];
															pass.texture_location[mipmap_level] = location.location;
															pass.texture_format = location.format;
															if(mipmap_level === 0) {
																pass.texture_log_width = Math.ceil(Math.log2(location.width));
																pass.texture_log_height = Math.ceil(Math.log2(location.height));
															}
															return blob_path.replace(gamefile, materials.to_blob());
														})
														close();
													}}
													selected={pass.texture_location[mipmap_level] === location.location}
												>{location.location} ({GsStorageFormat[location.format]})</MenuItem>
											})}
										</Dropdown>
									))}
									{pass.texture_location.length > 1 && <IconButton onClick={() => {
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											if(pass.texture_location.length > 1) pass.texture_location.length--;
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}><Remove /></IconButton>}
									{pass.texture_location.length < 4 && <IconButton onClick={() => {
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											if(pass.texture_location.length < 4) pass.texture_location.push(0);
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}><AddIcon /></IconButton>}
								</Box>
								{pass.texture_format !== GsStorageFormat.PSMCT32 && <Box sx={{mh:1}}><Dropdown label={`CLUT Location: ${pass.clut_location}`}>
									{close => images[selected_material.texture_file].locations.map(location => {
										if(!location.is_clut) return undefined;
										return <MenuItem
											key={location.location}
											onClick={() => {
												props.callbacks.edit_gamefile(async gamefile => {
													let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
													let pass = materials.materials[selected].passes[pass_index];
													pass.clut_location = location.location;
													return blob_path.replace(gamefile, materials.to_blob());
												})
												close();
											}}
											selected={pass.clut_location === location.location}
										>{location.location} (for {location.height === 16 ? "PSMT8" : "PSMT4"})</MenuItem>
									})}
								</Dropdown></Box>}
								{pass.shader_type !== ShaderType.Unlit && <FormControlLabel label="Reflection Mapped" control={
									<Switch
										checked={pass.metallic}
										onChange={(e, v) => {
											props.callbacks.edit_gamefile(async gamefile => {
												let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
												let pass = materials.materials[selected].passes[pass_index];
												pass.metallic = v;
												return blob_path.replace(gamefile, materials.to_blob());
											})
										}}
									/>
								}/>}
								<Typography sx={{display: 'block'}}>Scroll X</Typography>
								<Slider
									min={-(0.05**0.25)} max={0.05**0.25} step={0.0001}
									defaultValue={Math.abs(pass.scroll_rate_x)**0.25 * Math.sign(pass.scroll_rate_x)}
									key={[selected, object_key(props.materials), props.path, "x"].join(",")}
									valueLabelDisplay="auto"
									valueLabelFormat={(v) => {
										if(v**4 < 1e-7) return "0 per second"
										return ((v)**4 * Math.sign(v) * 60).toPrecision(4) + " per second"
									}}
									marks={[{value:0}]}
									onChangeCommitted={(e, v) => {
										let val = (v as number)**4 * Math.sign(v as number);
										if((v as number)**4 < 1e-7) val = 0;
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											pass.scroll_rate_x = val;
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}
								/>
								<Typography sx={{display: 'block'}}>Scroll Y</Typography>
								<Slider
									min={-(0.05**0.25)} max={0.05**0.25} step={0.0001}
									defaultValue={Math.abs(pass.scroll_rate_y)**0.25 * Math.sign(pass.scroll_rate_y)}
									key={[selected, object_key(props.materials), props.path, "y"].join(",")}
									valueLabelDisplay="auto"
									valueLabelFormat={(v) => {
										if(v**4 < 1e-7) return "0 per second"
										return ((v)**4 * Math.sign(v) * 60).toPrecision(4) + " per second"
									}}
									marks={[{value:0}]}
									onChangeCommitted={(e, v) => {
										let val = (v as number)**4 * Math.sign(v as number);
										if((v as number)**4 < 1e-7) val = 0;
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											pass.scroll_rate_y = val;
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}
								/>
								<Typography sx={{display: 'block'}}>Min Filter</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="min_filter" mat_index={selected}
									pass_index={pass_index} enum={GsFilter} callbacks={props.callbacks}
									values={[GsFilter.LINEAR, GsFilter.NEAREST]}
								/>
								<PassGroup
									pass={pass} path={blob_path} pass_key="min_filter" mat_index={selected}
									pass_index={pass_index} enum={GsFilter} callbacks={props.callbacks}
									values={[GsFilter.LINEAR_MIPMAP_LINEAR, GsFilter.LINEAR_MIPMAP_NEAREST, GsFilter.NEAREST_MIPMAP_LINEAR, GsFilter.NEAREST_MIPMAP_NEAREST]}
								/>
								<Typography sx={{display: 'block'}}>Mag Filter</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="mag_filter" mat_index={selected}
									pass_index={pass_index} enum={GsFilter} callbacks={props.callbacks}
									values={[GsFilter.LINEAR, GsFilter.NEAREST]}
								/>
								<Typography sx={{display: 'block'}}>Horizontal Wrapping</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="wrap_h" mat_index={selected}
									pass_index={pass_index} enum={GsWrapMode} callbacks={props.callbacks}
									values={[GsWrapMode.CLAMP, GsWrapMode.REPEAT]}
								/>
								<Typography sx={{display: 'block'}}>Vertical Wrapping</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="wrap_v" mat_index={selected}
									pass_index={pass_index} enum={GsWrapMode} callbacks={props.callbacks}
									values={[GsWrapMode.CLAMP, GsWrapMode.REPEAT]}
								/>
							</>}
							<Box><FormControlLabel label="Alpha Test" control={<Switch
								checked={pass.alpha_test_on}
								onChange={(e, v) => {
									props.callbacks.edit_gamefile(async gamefile => {
										let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
										let pass = materials.materials[selected].passes[pass_index];
										pass.alpha_test_on = v;
										return blob_path.replace(gamefile, materials.to_blob());
									})
								}}
							/>} /></Box>
							{pass.alpha_test_on && <>
								<Typography sx={{display: 'block'}}>Alpha Test Method</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="alpha_test_method" mat_index={selected}
									pass_index={pass_index} enum={GsAlphaTestMethod} callbacks={props.callbacks}
								/>
								<Typography sx={{display: 'block'}}>Alpha Test Reference</Typography>
								<Slider
									min={0} max={255} step={1}
									defaultValue={Math.round(pass.alpha_test_ref * 128)}
									key={[selected, object_key(props.materials), props.path, pass.alpha_test_ref, "alpha fixed"].join(",")}
									valueLabelFormat={v => (v / 128).toFixed(3)}
									valueLabelDisplay="auto"
									onChangeCommitted={(e, v) => {
										let val = v as number;
										if(val/128 === pass.alpha_test_ref) return;
										props.callbacks.edit_gamefile(async gamefile => {
											let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
											let pass = materials.materials[selected].passes[pass_index];
											pass.alpha_test_ref = val/128;
											return blob_path.replace(gamefile, materials.to_blob());
										})
									}}
								/>
								<Typography sx={{display: 'block'}}>Alpha Test Fail Method</Typography>
								<PassGroup
									pass={pass} path={blob_path} pass_key="alpha_fail_method" mat_index={selected}
									pass_index={pass_index} enum={GsAlphaFailMethod} callbacks={props.callbacks}
								/>
							</>}
							<Typography sx={{display: 'block'}}>Depth Test</Typography>
							<PassGroup
								pass={pass} path={blob_path} pass_key="depth_test_method" mat_index={selected}
								pass_index={pass_index} enum={GsDepthTestMethod} callbacks={props.callbacks}
							/>
						</AccordionDetails>
					</Accordion>))}
					<Button onClick={() => {
						props.callbacks.edit_gamefile(async gamefile => {
							let materials = await MaterialsChunk.from_blob((await blob_path.resolve(gamefile)));
							let mat = materials.materials[selected];
							if(mat.passes.length >= 2) {
								mat.passes.length = 1;
							} else {
								let pass = new MaterialPass();
								pass.shader_type = mat.passes[0].shader_type;
								mat.passes.push(pass);
							}
							return blob_path.replace(gamefile, materials.to_blob());
						});
					}}>{selected_material.passes.length >= 2 ? "Remove" : "Add"} second pass</Button>
				</>}
			</Box>
		</Box></Box>
	)
}

// https://stackoverflow.com/a/49752227
type KeyOfType<T, V> = keyof {
	[P in keyof T as T[P] extends V? P: never]: any
};

function format_camel_case(s : string) {
	return s.replace(/([a-z])([A-Z])/g, (a,b,c) => `${b} ${c}`);
}

function Dropdown(props : {
	label : string|ReactElement,
	children : (close : ()=>void) => ReactElement|(ReactElement|undefined)[]|undefined
}) {
	let [open, set_open] = useState<HTMLElement|undefined>(undefined);
	return <>
		<Button
			onClick={(e) => {
				set_open(e.currentTarget);
			}}
		>{props.label}</Button>
		<Menu
			anchorEl={open}
			open={!!open}
			onClose={() => set_open(undefined)}
		>
			{props.children(() => set_open(undefined))}
		</Menu>
	</>;
}

function PassDropdown<T extends KeyOfType<MaterialPass, number>>(props : {
	callbacks : AppCallbacks
	pass : MaterialPass,
	path : GamefilePath<Blob>,
	pass_key : T,
	mat_index : number,
	pass_index : number,
	enum : {[x : number] : string},
	values? : Array<MaterialPass[T]>
}) {
	return <Dropdown label={format_camel_case(props.enum[props.pass[props.pass_key] as number])}>
		{close => ((props.values ?? Object.keys(props.enum)).map((a:string|number) => {
			if(typeof props.enum[a as unknown as number] !== "string") return undefined;
			let val = +a;
			let name = props.enum[val];
			return <MenuItem
				key={a}
				selected={props.pass[props.pass_key] === val}
				onClick={() => {
					props.callbacks.edit_gamefile(async gamefile => {
						let materials = await MaterialsChunk.from_blob((await props.path.resolve(gamefile)));
						let pass = materials.materials[props.mat_index].passes[props.pass_index];
						(pass[props.pass_key] as unknown as number) = val;
						return props.path.replace(gamefile, materials.to_blob());
					});
					close();
				}}
			>{format_camel_case(name)}</MenuItem>
		}))}
	</Dropdown>;
}

function PassGroup<T extends KeyOfType<MaterialPass, number>>(props : {
	callbacks : AppCallbacks
	pass : MaterialPass,
	path : GamefilePath<Blob>,
	pass_key : T,
	mat_index : number,
	pass_index : number,
	enum : {[x : number] : string},
	values? : Array<MaterialPass[T]>
}) {
	return <ButtonGroup>
		{(props.values ?? Object.keys(props.enum)).map((a:string|number) => {
			if(typeof props.enum[a as unknown as number] !== "string") return undefined;
			let val = +a;
			let name = props.enum[val];
			return <Button
				key={a}
				variant={props.pass[props.pass_key] === val ? "contained" : "outlined"}
				onClick={() => {
					props.callbacks.edit_gamefile(async gamefile => {
						let materials = await MaterialsChunk.from_blob((await props.path.resolve(gamefile)));
						let pass = materials.materials[props.mat_index].passes[props.pass_index];
						(pass[props.pass_key] as unknown as number) = val;
						return props.path.replace(gamefile, materials.to_blob());
					});
				}}
			>{format_camel_case(name)}</Button>
		})}
	</ButtonGroup>;
}
