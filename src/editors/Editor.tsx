import { Alert, Box, CircularProgress } from "@mui/material";
import { Chunk, ChunkFile, ChunkType, Gamefile, TableChunk, ImageChunk, ModelChunk, TableFormats, MaterialsChunk, InstancedModelsChunk, CollisionChunk, VagAudio } from "ntdf-modding-toolkit";
import { useEffect, useMemo } from "react";
import { AppCallbacks } from "../App";
import { useAsyncMemo } from "../async_memo";
import { GamefilePath, GamefilePathChunkBlob, GamefilePathChunkFile } from "../path";
import { HexEditor } from "./HexEditor";
import { TableEditor } from "./TableEditor";
import { ImageEditor } from "./ImageEditor";
import { ModelViewer } from "./model_viewer/ModelViewer";
import { InstancedModelsEditor } from "./InstancedModelsEditor";
import { MaterialsEditor } from "./MaterialsEditor";
import { VagEditor } from "./VagEditor";

export function Editor(props : {
	callbacks : AppCallbacks,
	path : GamefilePath<any>,
	gamefile : Gamefile,
	visible: boolean,
}) {
	let memo_key = useMemo(() => ({path:props.path, gamefile:props.gamefile}), [props.path, props.gamefile]);
	let [info, loaded] = useAsyncMemo(async ({path, gamefile}) => {
		try {
			let resolved = await path.resolve(gamefile);
			if(resolved instanceof Chunk) {
				let chunk_data : TableChunk<any>|ImageChunk|ModelChunk|MaterialsChunk|InstancedModelsChunk|CollisionChunk|undefined = undefined;
				let table_headers : string[]|undefined = undefined;
				let table_header_sizes : Array<number|undefined>|undefined = undefined;
				let images : ImageChunk[]|undefined = undefined;
				let materials : MaterialsChunk|undefined = undefined;
				if(resolved )
				if(resolved.type === ChunkType.DialogueTable) {
					chunk_data = await TableChunk.from_blob(resolved.contents, TableFormats.dialogue_table);
					table_headers = ["Speaker", "Dialogue Text", "Background Color"];
					table_header_sizes = [200,undefined,200];
				} else if(resolved.type === ChunkType.Image) {
					chunk_data = await ImageChunk.from_blob(resolved.contents);
				} else if(resolved.type === ChunkType.Model || resolved.type === ChunkType.DynamicModel || resolved.type === ChunkType.WorldModel) {
					chunk_data = await ModelChunk.from_blob(resolved.contents);
					try {
						let materials_source = await GamefilePath.infer_materials_source(path)?.resolve(gamefile);
						if(materials_source) {
							materials = await MaterialsChunk.from_blob(materials_source.get_chunk_of_type(ChunkType.Materials).contents);
							images = await Promise.all(materials_source.get_chunks_of_type(ChunkType.Image).map(a => ImageChunk.from_blob(a.contents)));
						}
					} catch(e) {
						console.error(e);
					}
				} else if(resolved.type === ChunkType.InstancedModels) {
					chunk_data = await InstancedModelsChunk.from_blob(resolved.contents);
				} else if(resolved.type === ChunkType.Materials) {
					chunk_data = await MaterialsChunk.from_blob(resolved.contents);
				} else if(resolved.type === ChunkType.Collision) {
					chunk_data = await CollisionChunk.from_blob(resolved.contents);
				}
				return {
					chunk: resolved,
					chunk_data,
					table_headers,
					table_header_sizes,
					images,
					materials,
					blob_path: new GamefilePathChunkBlob(path),
					blob: resolved.contents,
					title: (ChunkType[resolved.type] ?? ("Chunk " + resolved.type)).replace(/([a-z])([A-Z])/g, (m,a,b) => `${a} ${b}`)
				};
			} else if(resolved instanceof ChunkFile) {
				let blob_path = (path instanceof GamefilePathChunkFile) ? path.parent : undefined;
				let materials = await MaterialsChunk.from_blob(resolved.get_chunk_of_type(ChunkType.Materials).contents).catch(async () => undefined);
				let images = await Promise.all(resolved.get_chunks_of_type(ChunkType.Image).map(a => ImageChunk.from_blob(a.contents)));
				let collision = await CollisionChunk.from_blob(resolved.get_chunk_of_type(ChunkType.Collision).contents).catch(async () => undefined);
				let world_model = await ModelChunk.from_blob(resolved.get_chunk_of_type(ChunkType.WorldModel).contents).catch(async () => undefined);
				
				let ret = {
					chunk_file: resolved,
					title: "Chunk File",
					materials, images, collision, world_model,
					blob: undefined, blob_path: undefined
				};
				if(blob_path) return {
					...ret,
					blob_path,
					blob: await blob_path.resolve(gamefile)
				};
				return ret;
			} else if(resolved instanceof VagAudio) {
				return {
					vag: resolved,
					blob_path: path,
					blob: resolved,
					title: resolved.name || "VAG Audio"
				};
			} else if(resolved instanceof Blob) {
				return {
					blob_path: path,
					blob: resolved,
					title: "Hex Data"
				};
			}
		} catch(e) {
			console.error(e);
			return {error: e, blob: undefined, blob_path: undefined, title: "Error"}
		}
	}, memo_key);
	useEffect(() => {
		props.callbacks.set_tab_properties(props.path, info?.title ?? "?", loaded);
	}, [info, loaded, props.callbacks, props.path]);
	if(info && "error" in info) {
		let text = info.error instanceof Error ? (info.error.stack ?? ""+info.error) : ""+info.error;
		return (
			<Box sx={{p:2}}>
				<Alert severity="error">
					<pre>
						{text}
					</pre>
				</Alert>
			</Box>
		)
	}
	if(info && "chunk_data" in info) {
		if(info.chunk_data instanceof TableChunk) {
			return (
				<TableEditor
					table={info.chunk_data}
					path={props.path}
					callbacks={props.callbacks}
					header_text={info.table_headers}
					header_sizes={info.table_header_sizes}					
				/>
			)
		} else if(info.chunk_data instanceof ImageChunk) {
			return (
				<ImageEditor
					callbacks={props.callbacks}
					path={props.path}
					image={info.chunk_data}
					gamefile={props.gamefile}
				/>
			)
		} else if(info.chunk_data instanceof ModelChunk) {
			return (
				<ModelViewer
					visible={props.visible}
					container_props={{style: {position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}}
					model={info.chunk_data}
					materials={info.materials}
					images={info.images}
				/>
			)
		} else if(info.chunk_data instanceof CollisionChunk) {
			return (
				<ModelViewer
					visible={props.visible}
					container_props={{style: {position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}}
					collision={info.chunk_data}
				/>
			)
		} else if(info.chunk_data instanceof InstancedModelsChunk) {
			return (
				<InstancedModelsEditor
					models={info.chunk_data}
					path={props.path}
					callbacks={props.callbacks}
				/>
			)
		} else if(info.chunk_data instanceof MaterialsChunk) {
			return (
				<MaterialsEditor
					materials={info.chunk_data}
					path={props.path}
					callbacks={props.callbacks}
					gamefile={props.gamefile}
					visible={props.visible}
				/>
			)
		}
	}
	if(info && ("chunk_file" in info) && info.world_model) {
		return (
			<ModelViewer
				visible={props.visible}
				container_props={{style: {position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}}
				materials={info.materials}
				images={info.images}
				collision={info.collision}
				model={info.world_model}
			/>
		)
	}
	if(info && ("vag" in info) && info.vag) {
		return (
			<VagEditor
				vag={info.vag}
				path={props.path}
				callbacks={props.callbacks}
			/>
		);
	}
	if(info?.blob) {
		return (
			<HexEditor
				blob={info.blob}
				path={info.blob_path}
				callbacks={props.callbacks}
			/>
		)
	}
	if(!loaded) {
		return (
			<CircularProgress />
		)
	} else {
		return (
			<></>
		)
	}
}