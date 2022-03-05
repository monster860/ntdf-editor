import React, { ForwardedRef, ReactElement, useCallback, useMemo, useRef, useState } from "react";
import {Chunk, ChunkFile, ChunkType, Gamefile, SectorMapChunk, TableChunk, TableFormats, VagAudio} from "ntdf-modding-toolkit";
import { Alert, AlertTitle, Box, Collapse, Divider, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Skeleton, Tooltip } from "@mui/material";
import { ScrollPromiseQueue } from "./scroll_promise_queue";
import CategoryIcon from '@mui/icons-material/Category';
import DataArrayIcon from '@mui/icons-material/DataArray';
import BurstModeIcon from '@mui/icons-material/BurstMode';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import CodeIcon from '@mui/icons-material/Code';
import GradientIcon from '@mui/icons-material/Gradient';
import TitleIcon from '@mui/icons-material/Title';
import TerrainIcon from '@mui/icons-material/Terrain';
import MessageIcon from '@mui/icons-material/Message';
import { ExpandLess, ExpandMore, VolumeUp } from "@mui/icons-material";
import { world_names } from "./world_names";
import { BlobCaches } from "./blob_caches";
import { GamefilePath, GamefilePathChunk, GamefilePathChunkBlob, GamefilePathChunkFile, GamefilePathFile, GamefilePathSingleChunk, GamefilePathSubGamefile, GamefilePathVag } from "./path";
import { useAsyncMemo } from "./async_memo";
import { AppCallbacks } from "./App";
import { Virtuoso } from "react-virtuoso";

const ChunkFileItem = React.forwardRef(
	function ChunkFileItem(props : {
		root : Gamefile,
		path : GamefilePath<ChunkFile>,
		file : ChunkFile,
		icon? : ReactElement,
		title? : ReactElement|string,
		secondary? : ReactElement|string,
		container_size? : number
		promise_queue : ScrollPromiseQueue,
		open_path : GamefilePath<any>|undefined,
		callbacks : AppCallbacks
	}, ref : ForwardedRef<HTMLLIElement>) {
		let our_ref = useRef<HTMLButtonElement>(null);
		let [open, set_open] = useState(false);
		let toggle_open = useCallback(() => {
			set_open(o => !o);
		}, []);
		let context_menu_handler = useCallback((e : React.MouseEvent) => {
			props.callbacks.open_context_menu(e.clientX, e.clientY, props.path);
			e.preventDefault();
		}, [props.path, props.callbacks]);
		let [special_info] = useAsyncMemo((file) => {
			return props.promise_queue.add(async () => {
				let world_infos = file.get_chunks_of_type(ChunkType.WorldInfo);
				if(world_infos.length) {
					let world_info = await TableChunk.from_blob(world_infos[0].contents, TableFormats.world_info);
					let type = world_info.entries[0][4];
					let id = world_info.entries[0][0];
					return {
						max_size: (type === 0 ? Gamefile.EXTERIOR_SIZE_LIMIT : Gamefile.TRANSITION_SIZE_LIMIT),
						title: `(${['Exterior','Transition','Interior'][type]}) ${world_names.get(id) ?? "Unknown Area"}`,
						id_addendum: ` {${id}}`,
						is_world: true,
					};
				}
			}, our_ref);
		}, props.file);
		let title = props.title ?? special_info?.title ?? `Chunk File (${props.file.chunks.length})`;
		let icon = props.icon ?? (special_info?.is_world ? <TerrainIcon color="primary" /> : <CategoryIcon color="secondary" />);
		icon = <ListItemIcon>{icon}</ListItemIcon>;
		let secondary = props.secondary ?? "";
		let size = useMemo(() => props.file.original_size ?? props.file.to_blob().size, [props.file]);
		let size_elem = <>{size_text(size)}</>
		if(props.container_size && size < props.container_size-2048) {
			size_elem = (
				<>
					{size_elem} <Tooltip componentsProps={{tooltip: {sx:{background:"transparent"}}}} title={
						<Alert variant="filled" severity="warning">
							<AlertTitle>There is a size mismatch!</AlertTitle>
							This file has a size of {size_text(props.container_size)} while its contents are only {size_elem}.
							This usually indicates that this file is split up into multiple pieces, and only the first piece
							is displayed. Avoid editing this file, as that would result in the additional pieces being lost.
						</Alert>
					}><span style={{cursor: 'help'}}>(<u>Size mismatch!</u>)</span></Tooltip>
				</>
			)
		}
		if(special_info?.max_size) {
			size_elem = <>{size_elem} / {size_text(special_info.max_size)}</>
		}
		secondary = <>{secondary}{size_elem}{special_info?.id_addendum}</>;

		let index_map = new Map<string, number>();
		return (
			<>
				<ListItem disablePadding ref={ref} sx={{background: "success"}} secondaryAction={
					<IconButton onClick={toggle_open} ref={our_ref}>
						{open ? <ExpandLess /> : <ExpandMore />}
					</IconButton>
				}>
					<ListItemButton onContextMenu={context_menu_handler} onClick={() => props.callbacks.open_file(props.path)} selected={props.open_path?.toString() === props.path.toString()}>
						{icon}
						<ListItemText secondary={secondary}>{title}</ListItemText>
					</ListItemButton>
				</ListItem>
				<Collapse in={open} unmountOnExit sx={{pl: 2}}>
					<Divider />
					{props.file.chunks.map((chunk) => {
						let index = (index_map.get(`${chunk.type},${chunk.id}`) ?? 0);
						index_map.set(`${chunk.type},${chunk.id}`, index+1);
						let key = `${chunk.type},${chunk.id},${index}`;
						let path = new GamefilePathChunk(props.path, chunk.type, chunk.id, index);
						return (
							<ChunkItem
								key={key}
								root={props.root}
								path={path}
								chunk={chunk}
								promise_queue={props.promise_queue}
								open_path={props.open_path}
								callbacks={props.callbacks}
							/>
						);
					})}
					<Divider />
				</Collapse>
			</>
		);
	}
);

const ChunkItem = React.forwardRef(
	function ChunkItem(props : {
		root : Gamefile,
		path : GamefilePath<Chunk>,
		chunk : Chunk,
		secondary? : ReactElement|string,
		promise_queue : ScrollPromiseQueue,
		open_path : GamefilePath<any>|undefined,
		callbacks : AppCallbacks
	}, ref : ForwardedRef<HTMLLIElement>) {
		let chunk_file_path = useMemo(() => new GamefilePathChunkFile(new GamefilePathChunkBlob(props.path)), [props.path]);
		let [contents] = useAsyncMemo(async (chunk) => {
			try {
				if(chunk.type === ChunkType.ModelList || chunk.type === ChunkType.AssetGroup) {
					return await BlobCaches.resolve_chunk_file(chunk.contents);
				} else if(chunk.type === ChunkType.CharacterAssets) {
					try {
						return await BlobCaches.resolve_chunk_file(chunk.contents);
					} catch(e) {
						return "is_skeleton";
					}
				}
			} catch(e) {
				console.error(e);
				return "error";
			}
			return undefined;
		}, props.chunk);

		let opener = useCallback(() => {
			props.callbacks.open_file(props.path);
		}, [props.callbacks, props.path]);
		let context_menu_handler = useCallback((e : React.MouseEvent) => {
			props.callbacks.open_context_menu(e.clientX, e.clientY, props.path);
			e.preventDefault();
		}, [props.path, props.callbacks]);

		let secondary = <>{props.secondary}{size_text(props.chunk.contents.size)}</>;
		let title = <>{ChunkType[props.chunk.type] ?? `Chunk ${props.chunk.type}`}</>;;
		let icon : ReactElement|undefined = undefined;
		switch(props.chunk.type) {
			case ChunkType.Materials:
				icon = <GradientIcon />;
				break;
			case ChunkType.WorldModel:
				icon = <TerrainIcon />
				break;
			case ChunkType.Image:
				icon = <BurstModeIcon />;
				break;
			case ChunkType.Model:
			case ChunkType.DynamicModel:
				secondary = <>{secondary} {`{${props.chunk.id}}`}</>;
				icon = <ViewInArIcon />;
				break;
			case ChunkType.ModelList:
				icon = <DataArrayIcon />;
				break;
			case ChunkType.Header:
				icon = <TitleIcon />;
				break;
			case ChunkType.LevelDLL:
				icon = <CodeIcon />;
				break;
			case ChunkType.DialogueTable:
				icon = <MessageIcon />;
				break;
			case ChunkType.CharacterAssets:
				if(contents === "is_skeleton") {
					title = <>Skeleton</>
				} else if(contents instanceof ChunkFile) {
					title = <>CharacterAssets</>
				} else {
					title = (<Skeleton variant="text" />);
				}
				break;
		}
		if(icon) {
			icon = <ListItemIcon>{icon}</ListItemIcon>;
		}
		if(contents instanceof ChunkFile) {
			return (
				<ChunkFileItem
					file={contents}
					path={chunk_file_path}
					root={props.root}
					icon={icon}
					ref={ref}
					secondary={props.secondary}
					title={title}
					promise_queue={props.promise_queue}
					open_path={props.open_path}
					callbacks={props.callbacks}
				/>
			)
		} else if(contents === "error") {
			title = <>{title} (Parsing error)</>
		}
		return (
			<ListItem disablePadding ref={ref}>
				<ListItemButton onClick={opener} onContextMenu={context_menu_handler} selected={props.open_path?.toString() === props.path.toString()}>
					{icon}
					<ListItemText inset={!icon} secondary={secondary}>{title}</ListItemText>
				</ListItemButton>
			</ListItem>
		)
	}
)

const FileItem = React.memo(
	function FileItem(props : {
		root : Gamefile,
		blob : Blob,
		blob_path : GamefilePath<Blob>,
		index? : number,
		promise_queue : ScrollPromiseQueue,
		is_root_file? : boolean,
		open_path : GamefilePath<any>|undefined,
		callbacks : AppCallbacks
	}) {
		const ref = useRef<HTMLLIElement>(null);
		const chunk_file_path = useMemo(() => new GamefilePathChunkFile(props.blob_path), [props.blob_path]);
		const single_chunk_path = useMemo(() => new GamefilePathSingleChunk(props.blob_path), [props.blob_path]);
		const vag_path = useMemo(() => new GamefilePathVag(props.blob_path), [props.blob_path]);
		const sector_map_path = useMemo(() => {
			if(props.is_root_file && props.root.num_files === 1434) {
				let sector_map_chunk_file = new GamefilePathChunkFile(new GamefilePathFile(GamefilePath.root, 533));
				if(props.index === 576) {
					return new GamefilePathChunk(sector_map_chunk_file, ChunkType.SectorMap, 0, 2);
				} else if(props.index === 144) {
					return new GamefilePathChunk(sector_map_chunk_file, ChunkType.SectorMap, 0, 0);
				} else if(props.index === 145) {
					return new GamefilePathChunk(sector_map_chunk_file, ChunkType.SectorMap, 0, 1);
				}
			}
			return undefined;
		}, [props.root, props.is_root_file, props.index]);
		const gamefile_path = useMemo(() => {
			return sector_map_path ? new GamefilePathSubGamefile(props.blob_path, sector_map_path) : undefined;
		}, [props.blob_path, sector_map_path]);
		const [sector_map, sector_map_loaded] = useAsyncMemo(async ([sector_map_path, root]) => {
			if(sector_map_path) {
				return await SectorMapChunk.from_blob((await sector_map_path.resolve(root)).contents);
			}
		}, useMemo(() => [sector_map_path, props.root] as const, [sector_map_path, props.root]));
		const sector_map_name = useMemo(() => {
			if(!sector_map) return "";
			return sector_map.name.substring(sector_map.name.lastIndexOf("/") + 1);
		}, [sector_map])
		const [resolved, loaded] = useAsyncMemo(([blob, sector_map]) => {
			return props.promise_queue.add(async () => {
				if(sector_map) {
					return new Gamefile(props.blob, sector_map);
				}
				try {
					return await BlobCaches.resolve_chunk_file(blob);
				} catch(e) {};
				try {
					return await BlobCaches.resolve_chunk(blob);
				} catch(e) {};
				try {
					return {
						vag_name: await VagAudio.get_name(blob)
					};
				} catch(e) {};
				return undefined;
			}, ref);
		}, useMemo(() => [props.blob, sector_map] as const, [props.blob, sector_map]));
		const [open, set_open] = useState(false);
		const toggle_open = useCallback(() => {
			set_open(o => !o);
		}, []);

		let context_menu_handler = useCallback((e : React.MouseEvent) => {
			props.callbacks.open_context_menu(e.clientX, e.clientY, props.blob_path);
			e.preventDefault();
		}, [props.blob_path, props.callbacks]);

		let index_text = "";
		if(props.index !== undefined) {
			index_text += `${props.index} (0x${props.index.toString(16)}) - `;
		}
		
		let size = size_text(props.blob.size);

		if(!resolved && (!loaded || !sector_map_loaded)) {
			return (
				<ListItem ref={ref}>
					<ListItemText secondary={`${index_text}${size}`} inset={true} onContextMenu={context_menu_handler}>
						<Skeleton animation={false} variant="text" />
					</ListItemText>
				</ListItem>
			);
		} else if(resolved instanceof Gamefile && gamefile_path) {
			return (
				<>
					<ListItem disablePadding ref={ref} sx={{background: "success"}} secondaryAction={
						<IconButton onClick={toggle_open}>
							{open ? <ExpandLess /> : <ExpandMore />}
						</IconButton>
					}>
						<ListItemButton onContextMenu={context_menu_handler}>
							<ListItemIcon><DataArrayIcon /></ListItemIcon>
							<ListItemText secondary={`${index_text}${size}`}>{sector_map_name} ({sector_map?.sectors.length} files)</ListItemText>
						</ListItemButton>
					</ListItem>
					<Collapse in={open} unmountOnExit sx={{pl: 2}}>
						<Divider />
						<FilesList
							callbacks={props.callbacks}
							gamefile={resolved}
							open_path={props.open_path}
							promise_queue={props.promise_queue}
							path={gamefile_path}
							root_gamefile={props.root}
						/>
						<Divider />
					</Collapse>
				</>
			)
		} else if(resolved instanceof ChunkFile) {
			return (
				<ChunkFileItem
					root={props.root}
					path={chunk_file_path}
					file={resolved}
					secondary={index_text}
					container_size={props.blob.size}
					promise_queue={props.promise_queue}
					open_path={props.open_path}
					callbacks={props.callbacks}
				/>
			)
		} else if(resolved instanceof Chunk) {
			return (
				<ChunkItem
					root={props.root}
					path={single_chunk_path}
					chunk={resolved}
					secondary={index_text}
					promise_queue={props.promise_queue}
					open_path={props.open_path}
					callbacks={props.callbacks}
				/>
			)
		} else if(resolved && ("vag_name" in resolved)) {
			return (
				<ListItem disablePadding ref={ref}>
					<ListItemButton onContextMenu={context_menu_handler} onClick={() => {
						props.callbacks.open_file(vag_path);
					}} selected={vag_path.toString() === props.open_path?.toString()}>
						<ListItemIcon><VolumeUp /></ListItemIcon>
						<ListItemText secondary={`${index_text}${size}`}>VAG Audio "{resolved.vag_name}"</ListItemText>
					</ListItemButton>
				</ListItem>
			)
		} else {
			return (
				<ListItem disablePadding ref={ref}>
					<ListItemButton onContextMenu={context_menu_handler}>
						<ListItemText secondary={`${index_text}${size}`} inset={true}>{props.blob.size === 0 ? "Empty File" : "Unknown File"}</ListItemText>
					</ListItemButton>
				</ListItem>
			)
		}
	}
);

function FilesList(props : {gamefile: Gamefile, promise_queue : ScrollPromiseQueue, path? : GamefilePath<Gamefile>, root_gamefile?: Gamefile, callbacks : AppCallbacks, open_path : GamefilePath<any>|undefined}) {
	let gamefile = props.gamefile;
	let path = props.path ?? GamefilePath.root;

	let paths = useMemo(() => {
		let paths : GamefilePath<Blob>[] = [];
		for(let i = 0; i < gamefile.num_files; i++) {
			paths.push(new GamefilePathFile(path, i));
		}
		return paths;
	}, [path, gamefile.num_files]);
	let files = useMemo(() => [...gamefile], [gamefile]);

	let path_part_str = props.open_path ? `${GamefilePath.flatten(props.open_path)[GamefilePath.flatten(path).length]}` : "";

	return (
		<List dense={true}>
			<Virtuoso
				data={files}
				useWindowScroll={true}
				itemContent={(index, file) => {
					return (
						<FileItem
							key={index}
							blob={file}
							blob_path={paths[index]}
							index={index}
							root={props.root_gamefile ?? gamefile}
							is_root_file={props.root_gamefile === undefined || props.root_gamefile === gamefile}
							promise_queue={props.promise_queue}
							open_path={paths[index].toString() === path_part_str ? props.open_path : undefined}
							callbacks={props.callbacks}
						/>
					);
				}}
			/>
			{/*[...gamefile].slice(0, 20).map((file, index) => {
				return (
					<FileItem
						key={index}
						blob={file}
						blob_path={paths[index]}
						index={index}
						root={props.root_gamefile ?? gamefile}
						is_root_file
						promise_queue={props.promise_queue}
						open_path={paths[index].toString() === path_part_str ? props.open_path : undefined}
						callbacks={props.callbacks}
					/>
				)
			})*/}
		</List>
	)
}

export default class FilesPane extends React.PureComponent<{gamefile?: Gamefile, callbacks : AppCallbacks, open_path? : GamefilePath<any>}> {
	list_ref = React.createRef<HTMLElement>();
	promise_queue = new ScrollPromiseQueue(this.list_ref, 1);
	handle_scroll = () => {
		window.dispatchEvent(new CustomEvent('scroll')); // this is really hacky and terrible but whatever
	}
	render() {
		return (
			<Box style={{overflow: 'auto', maxHeight: '100%', width: '100%'}} ref={this.list_ref} onScroll={this.handle_scroll}>
				{this.props.gamefile ? 
					(
						<FilesList
							gamefile={this.props.gamefile}
							promise_queue={this.promise_queue}
							callbacks={this.props.callbacks}
							open_path={this.props.open_path}
						/>
					)
				: null}
			</Box>
		);
	}
}

function size_text(size : number) : string {
	if(size > 1000000) return (size / 1000000).toFixed(2) + " MB";
	else if(size > 1000) return (size / 1000).toFixed(2) + " kB";
	else return size + " B";
}
