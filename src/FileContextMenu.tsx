import { CircularProgress, Menu, MenuItem } from "@mui/material";
import { fileOpen, fileSave } from "browser-fs-access";
import { Chunk, ChunkType, CollisionChunk, export_gltf, Gamefile, GridChunk, ImageChunk, import_gltf, MaterialsChunk, ModelChunk } from "ntdf-modding-toolkit";
import { LightsChunk } from "ntdf-modding-toolkit/build/chunks/lights";
import { useMemo } from "react";
import { AppCallbacks } from "./App";
import { useAsyncMemo } from "./async_memo";
import { GamefilePath, GamefilePathChunk, GamefilePathChunkBlob, GamefilePathChunkFile, GamefilePathSingleChunk, GamefilePathVag } from "./path";

export function FileContextMenu(props : {
	callbacks : AppCallbacks,
	path : GamefilePath<any>,
	gamefile : Gamefile,
	exclude_open_self? : boolean,
	open : boolean,
	onClose : ()=>void,
	x : number, y : number
}) {
	let blob_path : GamefilePath<Blob>|undefined = undefined;
	let contents_blob_path : GamefilePath<Blob>|undefined = undefined;
	
	if(props.path instanceof GamefilePathSingleChunk) {
		blob_path = props.path.parent;
		contents_blob_path = new GamefilePathChunkBlob(props.path);
	} else if(GamefilePath.is_chunk(props.path)) blob_path = new GamefilePathChunkBlob(props.path);
	else if(GamefilePath.is_blob(props.path)) blob_path = props.path;
	else if(props.path instanceof GamefilePathChunkFile || props.path instanceof GamefilePathVag) blob_path = props.path.parent;
	
	let can_open_self = GamefilePath.is_chunk(props.path) || GamefilePath.is_vag(props.path) || GamefilePath.is_chunk_file(props.path);
	let chunk_path = GamefilePath.is_chunk(props.path) ? props.path : undefined;
	if(GamefilePath.is_chunk_file(props.path) && GamefilePath.is_blob(props.path.parent) && GamefilePath.is_chunk(props.path.parent.parent)) chunk_path = props.path.parent.parent;
	let parent_chunk_file = (chunk_path instanceof GamefilePathChunk) ? chunk_path.parent : undefined;
	const [chunk, chunk_loaded] = useAsyncMemo(async ([gamefile, path]) => {
		return await path?.resolve(gamefile);
	}, useMemo(() => ([props.gamefile, chunk_path] as const), [props.gamefile, chunk_path]));
	let chunk_file_path = GamefilePath.is_chunk_file(props.path) ? props.path : undefined;
	const [chunk_file, chunk_file_loaded] = useAsyncMemo(async ([gamefile, path]) => {
		return await path?.resolve(gamefile);
	}, useMemo(() => ([props.gamefile, chunk_file_path] as const), [props.gamefile, chunk_file_path]));
	const materials_source_path = useMemo(() => GamefilePath.infer_materials_source(props.path), [props.path]);
	const [materials_source, materials_source_loaded] = useAsyncMemo(async ([gamefile, path]) => {
		try {
			if(!path) return undefined;
			return await path?.resolve(gamefile);
		} catch(e) {
			console.error(e);
			return undefined;
		}
	}, useMemo(() => ([props.gamefile, materials_source_path] as const), [props.gamefile, materials_source_path]));

	let is_model = (chunk !== undefined && (chunk.type === ChunkType.Model || chunk.type === ChunkType.DynamicModel || chunk.type === ChunkType.WorldModel));
	let is_collision = (chunk !== undefined && chunk.type === ChunkType.Collision);
	let is_exportable_chunk_file = (chunk_file !== undefined && (chunk_file.get_chunks_of_type(ChunkType.Materials).length > 0));
	let is_straight_blob = GamefilePath.is_blob(props.path);

	return (
		<Menu
			open={props.open}
			onClose={props.onClose}
			anchorReference="anchorPosition"
			anchorPosition={{left:props.x, top:props.y}}
		>
			{can_open_self && !props.exclude_open_self && (<MenuItem onClick={() => {
				props.callbacks.open_file(props.path);
				props.onClose();
			}}>Open</MenuItem>)}
			{is_straight_blob && props.exclude_open_self && (<MenuItem onClick={() => {
				if(blob_path) props.callbacks.open_file(new GamefilePathSingleChunk(blob_path));
				props.onClose();
			}}>Open as single chunk</MenuItem>)}
			{contents_blob_path && (!props.exclude_open_self || props.path !== contents_blob_path) && (<MenuItem onClick={() => {
				if(contents_blob_path) props.callbacks.open_file(contents_blob_path);
				props.onClose();
			}}>Open contents in hex editor</MenuItem>)}
			{blob_path && (!props.exclude_open_self || props.path !== blob_path) && (<MenuItem onClick={() => {
				if(blob_path) props.callbacks.open_file(blob_path);
				props.onClose();
			}}>Open in hex editor</MenuItem>)}
			{blob_path && (<MenuItem onClick={async () => {
				if(!blob_path) return;
				let blob = await blob_path.resolve(props.gamefile);
				fileSave(blob);
				props.onClose();
			}}>Export Binary Data</MenuItem>)}
			{blob_path && (<MenuItem onClick={async () => {
				let file = await fileOpen();
				props.callbacks.edit_gamefile(async (gamefile) => {
					if(!blob_path) return null;
					return blob_path.replace(gamefile, file);
				})
			}}>Import Binary Data</MenuItem>)}
			{parent_chunk_file && (<MenuItem onClick={() => {
				props.callbacks.edit_gamefile(async (gamefile, tabs) => {
					if(!parent_chunk_file || !chunk_path) return null;
					let [chunk_file, chunk] = await Promise.all([parent_chunk_file.resolve(gamefile), chunk_path.resolve(gamefile)]);
					if(!(chunk instanceof Chunk)) return null;
					chunk_file = chunk_file.copy();
					let index = chunk_file.chunks.indexOf(chunk);
					if(index < 0) return null;
					chunk_file.chunks.splice(index, 1);

					if(chunk.type === ChunkType.FineCollision) {
						for(let [i, chunk] of chunk_file.chunks.entries()) {
							if(chunk.type === ChunkType.WorldGrid) {
								let grid = await GridChunk.from_blob(chunk.contents);
								chunk = chunk_file.chunks[i] = chunk.copy();
								for(let tile of grid.grid) {
									if(tile) tile.fine_collision_refs = [];
								}
								grid.trim();
								chunk.contents = grid.to_blob();
							}
						}
					} else if(chunk.type === ChunkType.Collision) {
						let collision_id = (await CollisionChunk.from_blob(chunk.contents)).id;
						for(let [i, chunk] of chunk_file.chunks.entries()) {
							if(chunk.type === ChunkType.WorldGrid) {
								let grid = await GridChunk.from_blob(chunk.contents);
								chunk = chunk_file.chunks[i] = chunk.copy();
								grid.remove_collision(collision_id);
								grid.trim();
								chunk.contents = grid.to_blob();
							}
						}
					} else if(chunk.type === ChunkType.DynamicObjects) {
						let valid_collision_ids : number[] = [];
						for(let chunk of chunk_file.get_chunks_of_type(ChunkType.Collision)) {
							valid_collision_ids.push((await CollisionChunk.from_blob(chunk.contents)).id);
						}
						for(let [i, chunk] of chunk_file.chunks.entries()) {
							if(chunk.type === ChunkType.WorldGrid) {
								let grid = await GridChunk.from_blob(chunk.contents);
								chunk = chunk_file.chunks[i] = chunk.copy();
								for(let tile of grid.grid) {
									if(tile) {
										tile.breakable_refs = [];
										tile.collision_refs = tile.collision_refs.filter(ref => valid_collision_ids.includes(ref.chunk_id));
									}
								}
								grid.trim();
								chunk.contents = grid.to_blob();
							}
						}
					}

					return parent_chunk_file.replace(gamefile, chunk_file);
				});
				props.onClose();
			}}>Delete</MenuItem>)}
			{is_model && materials_source && (<MenuItem onClick={async () => {
				try {
					if(!materials_source || !chunk) return;
					let model = await ModelChunk.from_blob(chunk.contents);
					let materials = await MaterialsChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.Materials).contents);
					let images = await Promise.all(materials_source.get_chunks_of_type(ChunkType.Image).map(a => ImageChunk.from_blob(a.contents)));
					let exported = export_gltf(materials, images, {model});
					fileSave(new Blob([exported], {type: "model/gltf-binary"}), {
						description: "binary glTF",
						extensions: [".glb"],
						mimeTypes: ["model/gltf-binary"]
					});
				} catch(e) {
					props.callbacks.show_error(e);
					console.error(e);
				}
				props.onClose();
			}}>Export glTF{chunk?.type === ChunkType.WorldModel && " (Model Only)"}</MenuItem>)}
			{is_model && materials_source && (<MenuItem onClick={async () => {
				let glb = await fileOpen({
					description: "binary glTF",
					extensions: [".glb"],
					mimeTypes: ["model/gltf-binary"]
				});
				if(!materials_source || !chunk) return;
				props.callbacks.edit_gamefile(async (gamefile) => {
					if(!materials_source || !chunk_path) return null;
					let materials = await MaterialsChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.Materials).contents);
					let imported = import_gltf(await glb.arrayBuffer(), materials);
					return new GamefilePathChunkBlob(chunk_path).replace(gamefile, imported.model.to_blob());
				});
				props.onClose();
			}}>Import glTF{chunk?.type === ChunkType.WorldModel && " (Model Only)"}</MenuItem>)}
			{is_model && materials_source && (<MenuItem onClick={async () => {
				let glb = await fileOpen({
					description: "binary glTF",
					extensions: [".glb"],
					mimeTypes: ["model/gltf-binary"]
				});
				if(!materials_source || !chunk) return;
				props.callbacks.edit_gamefile(async (gamefile) => {
					if(!materials_source || !chunk_path) return null;
					let materials = await MaterialsChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.Materials).contents);
					let path = new GamefilePathChunkBlob(chunk_path);
					let imported = import_gltf(await glb.arrayBuffer(), materials);
					let model = await ModelChunk.from_blob(await path.resolve(gamefile));
					model.root.children.push(...imported.model.root.children);
					return new GamefilePathChunkBlob(chunk_path).replace(gamefile, model.to_blob());
				});
				props.onClose();
			}}>Import glTF{chunk?.type === ChunkType.WorldModel && " (Model Only)"} (Merge)</MenuItem>)}
			{is_collision && chunk && materials_source_path && materials_source && (<MenuItem onClick={async () => {
				let glb = await fileOpen({
					description: "binary glTF",
					extensions: [".glb"],
					mimeTypes: ["model/gltf-binary"]
				});
				props.callbacks.edit_gamefile(async (gamefile) => {
					if(!chunk_path) return null;
					let materials = await MaterialsChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.Materials).contents);
					let old = await CollisionChunk.from_blob(chunk.contents);
					let grid = await GridChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.WorldGrid).contents);
					let imported = import_gltf(await glb.arrayBuffer(), materials);
					let collision = imported.collision;
					if(!collision) return null;
					collision.id = old.id;
					grid.add_collision(collision);
					grid.trim();
					let grid_path = new GamefilePathChunkBlob(new GamefilePathChunk(materials_source_path, ChunkType.WorldGrid, 0, 0));
					gamefile = await grid_path.replace(gamefile, grid.to_blob());
					return new GamefilePathChunkBlob(chunk_path).replace(gamefile, collision.to_blob());
				});
				props.onClose();
			}}>Import glTF (Collision Only)</MenuItem>)}
			{is_exportable_chunk_file && (<MenuItem onClick={async () => {
				try {
					if(!chunk_file) return;
					let materials = await MaterialsChunk.from_blob(chunk_file.get_chunk_of_type(ChunkType.Materials).contents);
					let images = await Promise.all(chunk_file.get_chunks_of_type(ChunkType.Image).map(a => ImageChunk.from_blob(a.contents)));
					let model:ModelChunk|undefined = undefined;
					let collision:CollisionChunk|undefined = undefined;
					let lights:LightsChunk|undefined = undefined;
					for(let chunk of chunk_file.chunks) {
						if(chunk.type === ChunkType.WorldModel) {
							model = await ModelChunk.from_blob(chunk.contents);
						} else if(chunk.type === ChunkType.Collision) {
							collision = await CollisionChunk.from_blob(chunk.contents);
						} else if(chunk.type === ChunkType.Lights) {
							lights = await LightsChunk.from_blob(chunk.contents);
						}
					}

					let exported = export_gltf(materials, images, {model, collision, lights});
					fileSave(new Blob([exported], {type: "model/gltf-binary"}), {
						description: "binary glTF",
						extensions: [".glb"],
						mimeTypes: ["model/gltf-binary"]
					});
				} catch(e) {
					props.callbacks.show_error(e);
					console.error(e);
				}
				props.onClose();
			}}>Export glTF</MenuItem>)}
			{!(chunk_loaded && materials_source_loaded && chunk_file_loaded) && (<MenuItem disabled><CircularProgress /></MenuItem>)}
		</Menu>
	)
}


