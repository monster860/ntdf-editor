import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { Chunk, ChunkType, InstancedModel, InstancedModelsChunk, ModelChunk } from "ntdf-modding-toolkit";
import { useMemo, useState } from "react";
import { AppCallbacks } from "../App";
import { GamefilePath, GamefilePathChunkBlob, GamefilePathInstancedModel, GamefilePathInstancedModels } from "../path";
import { mat4 } from "gl-matrix";

interface InstanceDialog {
	open : boolean;
	edit_index : number|undefined;
	zone_id : number;
	translation : [number,number,number];
	rotation : [number,number,number,number];
	scale : [number,number,number];
}
interface LodDialog {
	open : boolean;
	render_distance : number;
	lod_distance : number;
	fade_depth : number
}

export function InstancedModelsEditor(props : {
	models : InstancedModelsChunk,
	callbacks : AppCallbacks,
	path : GamefilePath<Chunk>
}) {
	let path = useMemo(() => (new GamefilePathInstancedModels(new GamefilePathChunkBlob(props.path))), [props.path]);
	let [selected, set_selected] = useState(-1);
	let [edit, set_edit] = useState<InstanceDialog>({open: false, edit_index: undefined, zone_id: 0, translation: [0,0,0], rotation: [0,0,0,0], scale: [0,0,0]});
	let [lod_edit, set_lod_edit] = useState<LodDialog>({open: false, render_distance: 4000, lod_distance: 200, fade_depth: 0});
	let selected_model : InstancedModel|undefined = props.models.models[selected];
	return (
		<Box sx={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}} tabIndex={0}><Box sx={{display: "flex", flexDirection: "row", flexShrink: 1, position: 'absolute', width:'100%', height:'100%'}}>
			<Box style={{height: '100%', minWidth: 350}}>
				<List>
					{props.models.models.map((entry, index) => {
						return (
							<ListItem disablePadding key={index} secondaryAction={
								<IconButton onClick={() => {
									props.callbacks.edit_gamefile(async (gamefile) => {
										let models = await path.resolve(gamefile);
										models = models.copy();
										models.models.splice(index, 1);
										gamefile = await path.replace(gamefile, models);
										return gamefile;
									})
								}}><DeleteIcon /></IconButton>
							}>
								<ListItemButton selected={selected === index} onClick={() => {
									set_selected(index);
								}}>
									<ListItemText>
										{index} ({entry.instances.length} instances)
									</ListItemText>
								</ListItemButton>
							</ListItem>
						)	
					})}
					<ListItem disablePadding>
						<ListItemButton onClick={() => {
							props.callbacks.edit_gamefile(async (gamefile) => {
								let models = await path.resolve(gamefile);
								models = models.copy();
								models.models.push({
									model: new Chunk(new ModelChunk().to_blob(), ChunkType.DynamicModel),
									lod_model: undefined,
									render_distance: 4000,
									lod_distance: 200,
									fade_depth: 0,
									instances: [
										{
											zone_id: 0,
											transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
										}
									]
								});
								gamefile = await path.replace(gamefile, models);
								return gamefile;
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
				</List>
			</Box>
			<Box sx={{flexGrow: 1, height: '100%', overflow: 'auto'}}>
				{selected_model && <>
					<Button onClick={() => {
						props.callbacks.open_file(new GamefilePathInstancedModel(path, selected, false));
					}}>Open Model</Button>
					<Button onClick={() => {
						if(!selected_model || selected_model.lod_model) {
							props.callbacks.open_file(new GamefilePathInstancedModel(path, selected, true));
						} else {
							props.callbacks.edit_gamefile(async (gamefile) => {
								let models = await path.resolve(gamefile);
								models = models.copy();
								let model = models.models[selected];
								model = {...model};
								model.lod_model = model.model;
								models.models[selected] = model;
								gamefile = await path.replace(gamefile, models);
								return gamefile;
							})
						}
					}}>{selected_model.lod_model ? "Open" : "Add"} LOD Model</Button>

					<Paper sx={{p:1, maxWidth: 300}}>
						<div>Render distance: {selected_model.render_distance}</div>
						<div>LOD render distance: {selected_model.lod_distance}</div>
						<div>Fade depth: {selected_model.fade_depth}</div>
						<IconButton size="small" onClick={() => {
							if(!selected_model) return;
							set_lod_edit({
								open: true,
								render_distance: selected_model.render_distance,
								lod_distance: selected_model.lod_distance,
								fade_depth: selected_model.fade_depth
							});
						}}><EditIcon /></IconButton>
					</Paper>

					<TableContainer component={Paper}>
						<Table stickyHeader>
							<TableHead>
								<TableRow>
									<TableCell></TableCell>
									<TableCell>Translation</TableCell>
									<TableCell>Rotation</TableCell>
									<TableCell>Scale</TableCell>
									<TableCell>Zone ID</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{selected_model.instances.map((instance, index) => {
									let matrix:mat4 = instance.transform;
									let translation : [number,number,number] = [0,0,0];
									let rotation : [number,number,number,number] = [0,0,0,0];
									let scale : [number,number,number] = [0,0,0];
									mat4.getTranslation(translation, matrix);
									mat4.getScaling(scale, matrix);
									mat4.getRotation(rotation, matrix);
									return <TableRow key={index}>
										<TableCell><IconButton size="small" onClick={() => {
											set_edit({
												open: true,
												edit_index: index,
												rotation,
												translation,
												scale,
												zone_id: instance.zone_id
											})
										}}><EditIcon /></IconButton></TableCell>
										<TableCell>{translation.map(a => a.toFixed(2)).join(", ")}</TableCell>
										<TableCell>{rotation.map(a => a.toFixed(2)).join(", ")}</TableCell>
										<TableCell>{scale.map(a => a.toFixed(2)).join(", ")}</TableCell>
										<TableCell>{instance.zone_id}</TableCell>
									</TableRow>;
								})}
								<TableRow>
									<TableCell><IconButton size="small" onClick={() => {
										set_edit({
											open: true,
											edit_index: undefined,
											rotation: [0,0,0,1],
											translation: [0,0,0],
											scale: [1,1,1],
											zone_id: 0
										});
									}}><AddIcon /></IconButton></TableCell>
									<TableCell /><TableCell /><TableCell /><TableCell />
								</TableRow>
							</TableBody>
						</Table>
					</TableContainer>
				</>}
			</Box>
			<Dialog open={edit.open} maxWidth="lg" onClose={() => {set_edit(state => ({...state, open: false}));}}>
				<DialogTitle>{edit.edit_index !== undefined ? "Edit" : "Add"} Instance</DialogTitle>
				<DialogContent>
					<Box>
						{edit.translation.map((num, index) => (<TextField
							margin="dense"
							type="number"
							label={["X","Y","Z"][index]}
							value={num}
							key={index}
							onChange = {e => {
								set_edit(state => {
									let translation : [number,number,number] = [...state.translation]
									translation[index] = +e.target.value || 0;
									return {...state, translation}
								});
							}}
							inputProps={{step: 0}}
						/>))}
					</Box>
					<Box>
						{edit.rotation.map((num, index) => (<TextField
							margin="dense"
							type="number"
							label={["Rotation X","Rotation Y","Rotation Z","Rotation W"][index]}
							value={num}
							key={index}
							onChange = {e => {
								set_edit(state => {
									let rotation : [number,number,number,number] = [...state.rotation]
									rotation[index] = +e.target.value || 0;
									return {...state, rotation}
								});
							}}
							inputProps={{step: 0}}
						/>))}
					</Box>
					<Box>
						{edit.scale.map((num, index) => (<TextField
							margin="dense"
							type="number"
							label={["X Scale","Y Scale","Z Scale"][index]}
							value={num}
							key={index}
							onChange = {e => {
								set_edit(state => {
									let scale : [number,number,number] = [...state.scale]
									scale[index] = +e.target.value || 0;
									return {...state, scale}
								});
							}}
							inputProps={{step: 0}}
						/>))}
					</Box>
					<Box>
					<TextField
							margin="dense"
							type="number"
							label="Zone ID"
							value={edit.zone_id}
							onChange = {e => {
								set_edit(state => ({...state, zone_id:+e.target.value||0}));
							}}
							inputProps={{min: 0, max: 255}}
						/>
					</Box>
				</DialogContent>
				<DialogActions>
					{edit.edit_index !== undefined && <Button onClick={() => {
						set_edit(state => ({...state, open: false}));
						props.callbacks.edit_gamefile(async gamefile => {
							if(edit.edit_index === undefined) return null;
							let models = await path.resolve(gamefile);
							models = models.copy();
							let model = models.models[selected];
							model = {...model};
							models.models[selected] = model;
							model.instances = [...model.instances];
							model.instances.splice(edit.edit_index, 1);
							gamefile = await path.replace(gamefile, models);
							return gamefile;
						})
					}} color="error">Delete</Button>}
					<Button onClick={() => {set_edit(state => ({...state, open: false}));}}>Cancel</Button>
					<Button onClick={() => {
						set_edit(state => ({...state, open: false}));

						let transform:[number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
						mat4.fromRotationTranslationScale(transform, edit.rotation, edit.translation, edit.scale);

						props.callbacks.edit_gamefile(async gamefile => {
							let models = await path.resolve(gamefile);
							models = models.copy();

							let model = models.models[selected];
							model = {...model};
							let instance = {
								transform, zone_id: edit.zone_id
							};
							if(edit.edit_index !== undefined) {
								model.instances[edit.edit_index] = instance;
							} else {
								model.instances.push(instance);
							}
							gamefile = await path.replace(gamefile, models);
							return gamefile;
						})
					}}>{edit.edit_index !== undefined ? "Edit" : "Add"}</Button>
				</DialogActions>
			</Dialog>
			<Dialog open={lod_edit.open} onClose={() => {set_lod_edit(state => ({...state, open: false}));}}>
				<DialogTitle>Edit LOD Settings</DialogTitle>
				<DialogContent>
					<Box>
						<TextField
							margin="dense"
							type="number"
							label="Render distance"
							value={lod_edit.render_distance}
							onChange = {e => {
								set_lod_edit(state => ({...state, render_distance:+e.target.value||0}));
							}}
							inputProps={{min: 0, step: 0}}
						/>
					</Box>
					<Box>
						<TextField
							margin="dense"
							type="number"
							label="LOD render distance"
							value={lod_edit.lod_distance}
							onChange = {e => {
								set_lod_edit(state => ({...state, lod_distance:+e.target.value||0}));
							}}
							inputProps={{min: 0, step: 0}}
						/>
					</Box>
					<Box>
						<TextField
							margin="dense"
							type="number"
							label="Fade depth"
							value={lod_edit.fade_depth}
							onChange = {e => {
								set_lod_edit(state => ({...state, fade_depth:+e.target.value||0}));
							}}
							inputProps={{min: 0, step: 0}}
						/>
					</Box>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => {set_lod_edit(state => ({...state, open: false}));}}>Cancel</Button>
					<Button onClick={() => {
						set_lod_edit(state => ({...state, open: false}));

						props.callbacks.edit_gamefile(async gamefile => {
							let models = await path.resolve(gamefile);
							models = models.copy();

							let model = models.models[selected];
							model = {...model};
							models.models[selected] = model;
							
							model.lod_distance = lod_edit.lod_distance;
							model.render_distance = lod_edit.render_distance;
							model.fade_depth = lod_edit.fade_depth;

							gamefile = await path.replace(gamefile, models);
							return gamefile;
						})
					}}>Edit</Button>
				</DialogActions>
			</Dialog>
		</Box></Box>
	)
}
