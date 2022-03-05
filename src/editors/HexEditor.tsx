import { Box, Menu, MenuItem, Skeleton } from "@mui/material";
import React, { MutableRefObject, ReactElement, useCallback, useRef, useState } from "react";
import { useEffect } from "react";
import { useMemo } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { AppCallbacks } from "../App";
import { useAsyncMemo } from "../async_memo";
import { GamefilePath, GamefilePathBlobSlice } from "../path";
import { apply_replacements_to_blob, Replacement } from "./hex_replacement"

enum CursorState {
	NO_SELECT = 0,
	UPPER = 1,
	LOWER = 2,
	CHAR = 3,
};

const CHUNK_SIZE = 2048;

type CursorPoint = {byte : number, state : CursorState, select_from : number|undefined};

const blank_cursor : CursorPoint = {byte: -1, state: CursorState.NO_SELECT, select_from: undefined};
const everywhere_cursor : CursorPoint = {byte: -1, state: CursorState.CHAR, select_from: Infinity};

export function HexEditor(props : {
	blob : Blob,
	path : GamefilePath<Blob>,
	callbacks : AppCallbacks
}) {
	let [cursor, set_cursor] = useState(blank_cursor);
	let [context_menu, set_context_menu] = useState({x: 0, y: 0, open: false});
	let close_context_menu = () => {set_context_menu(context_menu => ({...context_menu, open: false}));};
	let virtuoso = useRef<VirtuosoHandle>(null);
	let scroller = useRef<HTMLElement>();
	let rendered_chunks = useRef<number[]>([]);

	let edit = useCallback((replacement : Replacement) => {
		props.callbacks.edit_gamefile(async gamefile => {
			return props.path.replace(gamefile, await apply_replacements_to_blob(await props.path.resolve(gamefile), [replacement]));
		});
	}, [props]);

	let copy = useCallback(async (e : React.ClipboardEvent<"div">) => {
		if(cursor.state === CursorState.NO_SELECT) return;
		e.preventDefault();
		let slice_blob = props.blob.slice(
			Math.min(cursor.byte, cursor.select_from ?? Infinity),
			Math.max(cursor.byte, cursor.select_from ?? -Infinity)+1
		);
		let buf : Uint8Array;
		if(navigator.clipboard !== undefined && navigator.clipboard.write !== undefined) {
			buf = new Uint8Array(await slice_blob.arrayBuffer());
		} else {
			let url = URL.createObjectURL(new Blob([slice_blob], {type: "text/plain; charset=x-user-defined"}));
			try {
				let xhr = new XMLHttpRequest();
				xhr.open('GET', url, false);
				xhr.send();

				let str = xhr.response;
				buf = new Uint8Array(str.length);
				for(let i = 0; i < str.length; i++) {
					buf[i] = str.charCodeAt(i);
				}
			} finally {
				URL.revokeObjectURL(url);
			}
		}
		let arr = [...buf];
		let str = "";
		if(cursor.state === CursorState.CHAR) {
			str = arr.map(a => (true_char_map[a])).join("");
		} else {
			str = arr.map(a => (a.toString(16).padStart(2, "0"))).join(" ");
		}
		if(navigator.clipboard !== undefined && navigator.clipboard.write !== undefined) {
			navigator.clipboard.writeText(str);
		} else {
			e.clipboardData.setData("text/plain", str);
		}
	}, [cursor, props.blob]);
	let paste = useCallback(async (e : React.ClipboardEvent<"div">) => {
		if(cursor.state === CursorState.NO_SELECT) return;
		e.preventDefault();
		let data = e.clipboardData.getData("text/plain");
		let bytes : number[] = [];
		if(cursor.state === CursorState.CHAR) {
			for(let char of data) {
				let byte = inv_char_map.get(char);
				if(byte !== undefined) bytes.push(byte);
			}
		} else {
			let trimmed = data.replace(/[^0-9a-f]/gi, "");
			if((trimmed.length % 2) !== 0) trimmed += "0";
			for(let i = 0; i < trimmed.length; i += 2) {
				bytes.push(parseInt(trimmed.substring(i, i+2), 16));
			}
		}
		let offset = cursor.byte;
		edit({offset, type: "range", value: bytes});
		set_cursor(cursor => ({state: cursor.state, byte: offset+bytes.length-1, select_from: offset}));
	}, [cursor, edit]);

	let key_down = useCallback((e : React.KeyboardEvent<"div">) => {
		let size = props.blob.size;
		if(size <= 0) return;

		if(e.code === "Tab") {
			if(cursor.state === CursorState.CHAR && e.shiftKey) {
				e.preventDefault()
				set_cursor(prev_cursor => {
					if(prev_cursor.state === CursorState.CHAR) {
						return {state: CursorState.UPPER, byte: prev_cursor.byte, select_from: prev_cursor.select_from};
					}
					return prev_cursor;
				});
			}
			else if((cursor.state === CursorState.LOWER || cursor.state === CursorState.UPPER) && !e.shiftKey) {
				e.preventDefault();
				set_cursor(prev_cursor => {
					if(cursor.state === CursorState.LOWER || cursor.state === CursorState.UPPER) {
						return {state: CursorState.CHAR, byte: prev_cursor.byte, select_from: prev_cursor.select_from};
					}
					return prev_cursor;
				});
			}
			return;
		}

		if(e.ctrlKey || e.altKey) return;

		let type_byte : number|undefined = undefined;
		let type_hex : number|undefined = undefined;
		if(e.code === "Enter") {
			type_byte = 0x10;
		} else if(e.code === "Delete") {
			type_byte = 0;
		} else if(e.key.length === 1) {
			type_byte = inv_char_map.get(e.key);
			let hex = "0123456789abcdef".indexOf(e.key.toLowerCase());
			if(hex >= 0) {
				type_hex = hex;
			}
		}
		if(e.code === "ArrowDown" || e.code === "ArrowUp" || e.code === "ArrowRight" || e.code === "PageDown" || e.code === "PageUp" || e.code === "ArrowLeft" || type_byte !== undefined) {
			e.preventDefault();
			set_cursor((prev_cursor) : CursorPoint => {
				if(prev_cursor.state === CursorState.NO_SELECT) return prev_cursor;
				let select_from = e.shiftKey ? (prev_cursor.select_from ?? prev_cursor.byte) : undefined;
				if(e.code === "ArrowDown" || e.code === "PageDown") {
					let new_byte = prev_cursor.byte + (e.code === "PageDown" ? 256 : 16);
					if(new_byte >= size) return {byte: size-1, state: prev_cursor.state === CursorState.CHAR ? CursorState.CHAR : CursorState.LOWER, select_from};
					return {byte: new_byte, state: prev_cursor.state, select_from};
				} else if(e.code === "ArrowUp" || e.code === "PageUp") {
					let new_byte = prev_cursor.byte - (e.code === "PageUp" ? 256 : 16);
					if(new_byte <= 0) return {byte: 0, state: prev_cursor.state === CursorState.CHAR ? CursorState.CHAR : CursorState.UPPER, select_from};
					return {byte: new_byte, state: prev_cursor.state, select_from};
				} else if(e.code === "ArrowLeft") {
					if(prev_cursor.state === CursorState.CHAR) {
						return {byte: Math.max(0, prev_cursor.byte-1), state: CursorState.CHAR, select_from};
					} else if(prev_cursor.state === CursorState.LOWER) {
						return {byte: prev_cursor.byte, state: CursorState.UPPER, select_from};
					} else if(prev_cursor.state === CursorState.UPPER) {
						if(prev_cursor.byte <= 0) return prev_cursor;
						return {byte: prev_cursor.byte-1, state: CursorState.LOWER, select_from};
					}
				} else {
					if(prev_cursor.state === CursorState.CHAR) { 
						if(type_byte !== undefined) edit({type: "byte", offset: prev_cursor.byte, value: type_byte});
						return {byte: Math.min(size-1, prev_cursor.byte+1), state: CursorState.CHAR, select_from: type_byte === undefined ? select_from : undefined};
					} else if(prev_cursor.state === CursorState.LOWER) {
						if(e.code !== "ArrowRight" && type_hex === undefined) return prev_cursor;
						if(type_hex !== undefined) edit({type: "lower", offset: prev_cursor.byte, value: type_hex});
						if(prev_cursor.byte >= size-1) return prev_cursor;
						return {byte: prev_cursor.byte+1, state: CursorState.UPPER, select_from: type_hex === undefined ? select_from : undefined};
					} else if(prev_cursor.state === CursorState.UPPER) {
						if(e.code !== "ArrowRight" && type_hex === undefined) return prev_cursor;
						if(type_hex !== undefined) edit({type: "upper", offset: prev_cursor.byte, value: type_hex});
						return {byte: prev_cursor.byte, state: CursorState.LOWER, select_from: type_hex === undefined ? select_from : undefined};
					}
				}
				return prev_cursor;
			});
		}
	}, [props.blob.size, cursor.state, edit]);
	let cursor_chunk = cursor.state === CursorState.NO_SELECT ? undefined : Math.floor(cursor.byte / CHUNK_SIZE);
	useEffect(() => {
		if(cursor_chunk !== undefined && !rendered_chunks.current.includes(cursor_chunk)) {
			virtuoso.current?.scrollToIndex({
				index: cursor_chunk,
				behavior: 'auto'
			});
		}
	}, [cursor.byte, cursor_chunk]);
	return (
		<div
			style={{
				height: "100%",
				outline: "none",
				overflowY: "hidden",
				position: "relative"
			}}
		>
			<Virtuoso
				ref={virtuoso}
				increaseViewportBy={{bottom: 1000, top: 1000}}
				scrollerRef={(el) => {
					if(el instanceof HTMLElement) scroller.current = el;
				}}
				itemsRendered={items => {
					rendered_chunks.current = items.map(a => a.index);
				}}
				useWindowScroll={false}
				totalCount={Math.ceil(props.blob.size / CHUNK_SIZE)}
				onKeyDown={key_down}
				onCopy={copy}
				onPaste={paste}
				onContextMenu={(e) => {set_context_menu({x: e.clientX, y: e.clientY, open: true}); e.preventDefault();}}
				itemContent={(index) => (
					<HexEditorChunk
						offset={index*CHUNK_SIZE}
						blob={props.blob}
						cursor={cursor}
						set_cursor={set_cursor}
						scroller={scroller}
					/>
				)}
			/>
			<Menu
				open={context_menu.open}
				onClose={close_context_menu}
				anchorReference="anchorPosition"
				anchorPosition={{left:context_menu.x, top:context_menu.y}}
			>
				{cursor.state !== CursorState.NO_SELECT && <MenuItem onClick={() => {
					close_context_menu();
					let start = Math.min(cursor.byte, cursor.select_from ?? Infinity);
					let end = cursor.select_from !== undefined ? Math.max(cursor.byte, cursor.select_from)+1 : undefined;
					let path = new GamefilePathBlobSlice(props.path, start, end);
					props.callbacks.open_file(path);
				}}>Open slice ({Math.min(cursor.byte, cursor.select_from ?? Infinity)}-{cursor.select_from !== undefined && Math.max(cursor.byte, cursor.select_from)})</MenuItem>}
			</Menu>
		</div>
	);
}

function HexEditorChunk(props : {
	offset : number,
	blob : Blob,
	cursor : CursorPoint,
	set_cursor : React.Dispatch<React.SetStateAction<CursorPoint>>,
	scroller : MutableRefObject<HTMLElement|undefined>,
}) {
	let chunk_blob = useMemo(() => props.blob.slice(props.offset, Math.min(props.blob.size, props.offset+CHUNK_SIZE)), [props.blob, props.offset]);
	let [data] = useAsyncMemo(blob => blob.arrayBuffer(), chunk_blob);
	let data_pieces = useMemo(() => {
		let lengths : number[] = [];
		let parts : Uint8Array[] = [];
		for(let i = 0; i < chunk_blob.size; i += 16) {
			let this_len = Math.min(16, chunk_blob.size - i);
			lengths.push(this_len);
			if(data) parts.push(new Uint8Array(data, i, this_len));
		}
		return parts.length ? parts : lengths;
	}, [data, chunk_blob]);

	let sel_min = Math.min(props.cursor.byte, props.cursor.select_from ?? Infinity);
	let sel_max = Math.max(props.cursor.byte, props.cursor.select_from ?? -Infinity);

	return (
		<div style={{userSelect: "none"}}>
			{data_pieces.map((value, index) => {
				let cursor = blank_cursor;
				if((props.cursor.byte&~0xF) === (props.offset+index*16)) cursor = props.cursor;
				else if(props.cursor.select_from !== undefined && ((props.cursor.select_from&~0xF) === (props.offset+index*16))) cursor = props.cursor;
				else if(sel_min < props.offset+index*16 && sel_max > props.offset+index*16+15) cursor = everywhere_cursor;
				return (
					<HexEditorRow
						offset={props.offset+index*16}
						max_addr={props.blob.size}
						data={value}
						key={index}
						cursor={cursor}
						set_cursor={props.set_cursor}
						scroller={props.scroller}
					/>
				);
			})}
		</div>
	);
}

const decoder = new TextDecoder('cp1252');
const char_map : string[] = [];
const true_char_map : string[] = [];
const inv_char_map = new Map<string, number>();
for(let i = 0; i < 256; i++) {
	let true_char = decoder.decode(new Uint8Array([i]));
	true_char_map.push(true_char);
	inv_char_map.set(true_char, i);
	if(i === 0) char_map.push("\u00b7");
	else if(i === "\n".charCodeAt(0)) char_map.push("\u21b5");
	else if(i <= 32) char_map.push("\u202f");
	else char_map.push(true_char);
}

const hex_digits = ['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'];

const HexEditorRow = React.memo(function HexEditorRow(props : {
	offset : number,
	max_addr : number,
	data : Uint8Array | number,
	cursor : CursorPoint,
	set_cursor : React.Dispatch<React.SetStateAction<CursorPoint>>,
	scroller : MutableRefObject<HTMLElement|undefined>,
}) {
	let [hovering, set_hovering] = useState(false);
	let ref = useRef<HTMLDivElement>(null);
	let set_cursor = props.set_cursor;
	let data_length = typeof props.data === "number" ? props.data : props.data.length;
	let num_hex_digits = 0;
	let max_addr_shift = props.max_addr;
	let sel_min = Math.min(props.cursor.byte, props.cursor.select_from ?? Infinity);
	let sel_max = Math.max(props.cursor.byte, props.cursor.select_from ?? -Infinity);
	let selected = props.cursor.state !== CursorState.NO_SELECT && (props.offset === (props.cursor.byte & ~15) || (props.cursor.select_from !== undefined && props.offset === (props.cursor.select_from & ~15)));
	
	useEffect(() => {
		if(selected) {
			ref.current?.scrollIntoView({
				block: "nearest",
				inline: "nearest",
				behavior: "auto",
			});
			setTimeout(() => {props.scroller.current?.dispatchEvent(new CustomEvent('scroll'))}, 0);
		}
	}, [selected, props.scroller]);
	while(max_addr_shift > 0) {
		max_addr_shift >>>= 4;
		num_hex_digits++;
	}
	let addr_text = props.offset.toString(16).padStart(num_hex_digits, "0") + " \u202f ";
	let bytes : ReactElement[] = [];
	let bytes_text_loading = "";
	let bytes_text = "";
	let chars : ReactElement[] = [];
	for(let i = 0; i < 16; i++) {
		let space = i < 15 ? " " : "";
		let upper : string;
		let lower : string;
		let char : string = "";
		if(i >= data_length) {upper = "\u202f"; lower = "\u202f";}
		else if(typeof props.data === "number") {
			bytes_text_loading += "\u202f\u202f" + space;
			continue;
		}
		else {
			upper = hex_digits[props.data[i] >>> 4];
			lower = hex_digits[props.data[i] & 0xF];
			char = char_map[props.data[i]];
		}
		if(selected || hovering) {
			let cursor_sel = (props.cursor.byte === (i+props.offset)) && props.cursor.state !== CursorState.NO_SELECT;
			let whole_sel = (i+props.offset >= sel_min && i+props.offset <= sel_max) && props.cursor.state !== CursorState.NO_SELECT;
			let after_sel = whole_sel && i+props.offset < sel_max;
			let upper_sel = cursor_sel && props.cursor.state === CursorState.UPPER;
			let lower_sel = cursor_sel && props.cursor.state === CursorState.LOWER;
			let char_sel = cursor_sel && props.cursor.state === CursorState.CHAR;
			bytes.push(
				<React.Fragment key={i}>
					<Box sx={{
						bgcolor: whole_sel ? 'action.selected' : undefined,
						textDecoration: upper_sel ? 'underline' : undefined,
						display: 'inline',
						userSelect: 'all',
						'&:hover': !upper_sel ? {bgcolor: 'action.hover'} : undefined
					}} component="span" onMouseDown={(e:React.MouseEvent) => {
						e.preventDefault();
						if(e.button !== 0) return;
						set_cursor(prev_cursor => ({byte: i+props.offset, state: CursorState.UPPER, select_from: e.shiftKey ? (prev_cursor.select_from ?? prev_cursor.byte) : undefined}));
					}}>{upper}</Box>
					<Box sx={{
						bgcolor: whole_sel ? 'action.selected' : undefined,
						textDecoration: lower_sel ? 'underline' : undefined,
						display: 'inline',
						userSelect: 'all',
						'&:hover': !lower_sel ? {bgcolor: 'action.hover'} : undefined
					}} component="span" onMouseDown={(e:React.MouseEvent) => {
						e.preventDefault();
						if(e.button !== 0) return;
						set_cursor(prev_cursor => ({byte: i+props.offset, state: CursorState.LOWER, select_from: e.shiftKey ? (prev_cursor.select_from ?? prev_cursor.byte) : undefined}));
					}}>{lower}
					</Box>{after_sel ? <Box sx={{bgcolor: 'action.selected',display:'inline'}} component="span">{space}</Box> : space}
				</React.Fragment>
			);
			chars.push(
				<Box key={i} sx={{
					bgcolor: whole_sel ? 'action.selected' : undefined,
					textDecoration: char_sel ? 'underline' : undefined,
					display: 'inline',
					userSelect: 'all',
					'&:hover': !char_sel ? {bgcolor: 'action.hover'} : undefined
				}} component="span" onMouseDown={(e:React.MouseEvent) => {
					e.preventDefault();
					if(e.button !== 0) return;
					set_cursor(prev_cursor => ({byte: i+props.offset, state: CursorState.CHAR, select_from: e.shiftKey ? (prev_cursor.select_from ?? prev_cursor.byte) : undefined}));
				}}>{char}</Box>
			)
		} else {
			bytes_text += upper+lower+space;
		}
	}
	if(!bytes.length) {
		if(sel_min < props.offset && sel_max > props.offset+15) {
			bytes.push(<Box key="text" sx={{bgcolor: 'action.selected',display: 'inline'}} component="span">{bytes_text}</Box>);	
		} else {
			bytes.push(<React.Fragment key="text">{bytes_text}</React.Fragment>);
		}
	}
	if(typeof props.data === "object" && !chars.length) {
		let chars_text = [...props.data].map(b => char_map[b]);
		if(sel_min < props.offset && sel_max > props.offset+15) {
			chars.push(<Box key="text" sx={{bgcolor: 'action.selected',display: 'inline'}} component="span">{chars_text}</Box>);	
		} else {
			chars.push(<React.Fragment key="text">{chars_text}</React.Fragment>);
		}
	}

	return <div onMouseMove={e => e.preventDefault()}onMouseEnter={set_hovering.bind(undefined, true)} onMouseLeave={set_hovering.bind(undefined, false)} ref={ref}>
		<code>
			{addr_text}
			{bytes_text_loading.length ? <Skeleton variant="text" sx={{display: 'inline'}} animation={false}>{bytes_text_loading}</Skeleton> : undefined}
			{bytes}
			{" \u202f "}
			{typeof props.data === "object" ? chars : <Skeleton variant="text" sx={{display: 'inline'}} animation={false}>{"".padStart(data_length, "\u202f")}</Skeleton>}
		</code>
	</div>
});
