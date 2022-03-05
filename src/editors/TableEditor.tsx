import { TableChunk, Chunk, TableFieldType, encode_text } from "ntdf-modding-toolkit";
import { AppCallbacks } from "../App";
import { GamefilePath, GamefilePathChunkBlob } from "../path";
import { TableRow, TableCell, Table, TableHead, IconButton, Menu, MenuItem, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, InputBaseComponentProps } from "@mui/material";
import React, { useMemo, useCallback } from "react";
import { TableVirtuoso } from "react-virtuoso";
import { ReactElement, useState } from "react";
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import { fileSave, fileOpen } from "browser-fs-access";

type EditDialogState = {
	values : string[],
	row : number,
	open : boolean
};

export function TableEditor(props : {
	table : TableChunk<readonly TableFieldType[]>,
	header_text? : string[],
	header_sizes? : Array<number|undefined>,
	path : GamefilePath<Chunk>,
	callbacks : AppCallbacks
}) {
	let [menu_anchor, set_menu_anchor] = useState<HTMLElement|null>(null);
	let [edit_dialog, set_edit_dialog] = useState<EditDialogState>({values:[], row:0, open: false});

	let dialog_validation = useMemo(() => {
		return edit_dialog.values.map((value, index) => {
			let format = props.table.format[index];
			if(value === undefined && format !== TableFieldType.String) return false;
			if(format === TableFieldType.String) {
				if(value === undefined || value === "[null]") return true;
				try {
					encode_text(value.replace(/\[br\]/g, "\n"));
				} catch(e) {
					return false;
				}
				return true;
			}
			if(format !== TableFieldType.Float) {
				return (+value === Math.floor(+value));
			}
			return !Number.isNaN(+value);
		})
	}, [edit_dialog.values, props.table.format]);

	let close_edit_dialog = useCallback(() => {
		set_edit_dialog(state => ({...state, open: false}));
	}, [])
	let header_content = useCallback(() => {
		return (
			<TableRow sx={{bgcolor: 'background.default'}}>
				<TableCell variant="head" sx={{width: 40}}><IconButton
					onClick={(e) => {set_menu_anchor(e.currentTarget);}}
				><MoreVertIcon /></IconButton></TableCell>
				<TableCell sx={{width: 40}}>Index</TableCell>
				{props.table.format.map((field, index) => {
					let label = props.header_text?.[index];
					let text = label ? `${label} (${TableFieldType[field]})` : TableFieldType[field]
					return (<TableCell key={index} variant="head" sx={{width: props.header_sizes?.[index]}}>{text}</TableCell>);
				})}
			</TableRow>
		);
	}, [props.table.format, props.header_text, props.header_sizes]);
	let row_content = useCallback((index, row : Array<string|number|null>) => {
		return (<><TableCell variant="body"><IconButton onClick={() => {
			set_edit_dialog({
				row: index,
				values: row.map(v => {
					if(typeof v === "string") {
						return v.replace(/\n/g, "[br]\n").replace(/\[next\]/g, "\n[next]\n");
					}
					return ""+(v ?? "[null]");
				}),
				open: true
			});
		}}><EditIcon /></IconButton></TableCell><TableCell variant="body">{index}</TableCell>{row.map((val, col) => {
			if(typeof val === "string") {
				return (<TableCell variant="body" key={col}>{val.split("[next]").map((text, next_idx) => {
					let color_split = text.split(/\[color\(\[([0-9]+,[0-9]+,[0-9]+,[0-9]+)\]\)\]/g);
					let color_parts : ReactElement[] = [];
					for(let i = 0; i < color_split.length; i += 2) {
						let text = color_split[i];
						let color = (color_split[i-1]?.split(",")?.map(Number) ?? [128,128,128,128]).map(a => Math.round(a / 128 * 255));
						let css_color = `rgba(${color[0]},${color[1]},${color[2]},${color[3]/255})`;
						color_parts.push(<span key={i} style={{color: css_color}}>{text}</span>)
					}

					return <div key={next_idx}>{color_parts}</div>;
				})}</TableCell>);
			}
			return <TableCell variant="body" key={col}>{val ?? null}</TableCell>
		})}</>)
	}, []);
	return (<>
		<TableVirtuoso
			data={props.table.entries}
			fixedHeaderContent={header_content}
			itemContent={row_content}
			components={{Table, TableHead, TableRow}}
		/>
		<Menu
			onClose={() => {set_menu_anchor(null);}}
			open={!!menu_anchor}
			anchorEl={menu_anchor}
		>
			<MenuItem onClick={() => {
				fileOpen([{
					extensions: [".csv"],
					mimeTypes: ["text/csv"]
				}]).then(async blob => {
					let text = await blob.text();
					let contents = [...(text.match(/(?:,|[^",\n][^,\n]*|"[^"]*")+/g) ?? [])].map(row_text => {
						return [...(row_text.match(/(^|,)(?:[^",][^,]*|"(?:""|[^"]+)*"|)(?=,|$)/g) ?? [])].map((col_text, col_index) => {
							if(col_text.startsWith(",")) col_text = col_text.substring(1);
							if(col_text.startsWith('"')) {
								col_text = col_text.substring(1, col_text.length-1).replace(/""/g, '"');
							}
							if(props.table.format[col_index] !== TableFieldType.String) return +col_text || 0;
							if(col_text === "[null]") return null;
							return col_text;
						});
					});
					props.callbacks.edit_gamefile(async gamefile => {
						let new_table_chunk = new TableChunk(props.table.format, contents);
						return await new GamefilePathChunkBlob(props.path).replace(gamefile, new_table_chunk.to_blob());
					});
				});
				set_menu_anchor(null);
			}}>Import CSV</MenuItem>
			<MenuItem onClick={() => {
				let as_csv = new Blob([props.table.entries.map(item => {
					return item.map(cell => {
						if(typeof cell === "number") return ""+cell;
						if(cell === null) return "[null]";
						if(/[,\n"]/.test(cell)) {
							return '"' + cell.replace(/"/g, '""') + '"';
						}
						return cell;
					}).join(",");
				}).join("\n")], {type: "text/csv"});
				fileSave(as_csv);
				set_menu_anchor(null);
			}}>Export CSV</MenuItem>
			<MenuItem onClick={() => {
				set_edit_dialog({open: true, values: [], row: props.table.entries.length})
				set_menu_anchor(null);
			}}>Add Row</MenuItem>
		</Menu>
		<Dialog open={edit_dialog.open} onClose={close_edit_dialog} maxWidth="lg" fullWidth>
			<DialogTitle>Editing Row {edit_dialog?.row}</DialogTitle>
			<DialogContent>
				{props.table.format.map((field, index) => {
					let label = props.header_text?.[index];
					let text = label ? `${label} (${TableFieldType[field]})` : TableFieldType[field]
					let inputProps:InputBaseComponentProps|undefined = undefined;
					if(field === TableFieldType.Uint32) inputProps = {min: 0, max: 0xFFFFFFFF};
					else if(field === TableFieldType.Int32) inputProps = {min:-0x80000000, max: 0x7FFFFFFF};
					else if(field === TableFieldType.Uint16) inputProps = {min: 0, max: 0xFFFF};
					else if(field === TableFieldType.Int16) inputProps = {min:-0x8000, max: 0x7FFF};
					else if(field === TableFieldType.Uint8) inputProps = {min: 0, max: 0xFF};
					else if(field === TableFieldType.Int8) inputProps = {min:-0x80, max: 0x7F};
					else if(field === TableFieldType.Float) inputProps = {step: 0};
					return (
						<TextField
							margin="dense"
							type={field === TableFieldType.String ? "text" : "number"}
							multiline={field === TableFieldType.String}
							fullWidth={field === TableFieldType.String}
							variant="outlined"
							value={edit_dialog?.values[index] ?? "[null]"}
							label={text}
							inputProps={inputProps}
							error={!dialog_validation[index]}
							onChange={event => {
								let text = event.target.value;
								set_edit_dialog(state => {
									let values = [...state.values];
									values[index] = text;
									return {
										...state,
										values
									};
								});
							}}
						/>
					)
				})}
			</DialogContent>
			<DialogActions>
				{edit_dialog.row < props.table.entries.length && (<Button onClick={() => {
					let entries = [...props.table.entries];
					entries.splice(edit_dialog.row, 1);
					let new_table_chunk = new TableChunk(props.table.format, entries);
					props.callbacks.edit_gamefile(async gamefile => {
						return await new GamefilePathChunkBlob(props.path).replace(gamefile, new_table_chunk.to_blob());
					})
					close_edit_dialog();
				}} color={edit_dialog.row < props.table.entries.length-1 ? "error" : "warning"}>Delete</Button>)}
				<Button onClick={close_edit_dialog}>Cancel</Button>
				<Button disabled={dialog_validation.includes(false)} onClick={()=>{
					let entries = [...props.table.entries];
					entries[edit_dialog.row] = props.table.format.map((field, index) => {
						let value_text = edit_dialog.values[index];
						if(field === TableFieldType.String) {
							if(value_text === undefined || value_text === "[null]") return null;
							return value_text.replace(/\n/g, '').replace(/\[br\]/g, '\n');
						}
						return +value_text || 0;
					});
					let new_table_chunk = new TableChunk(props.table.format, entries);
					props.callbacks.edit_gamefile(async gamefile => {
						return await new GamefilePathChunkBlob(props.path).replace(gamefile, new_table_chunk.to_blob());
					})
					close_edit_dialog();
				}} variant="contained">OK</Button>
			</DialogActions>
		</Dialog>
	</>);
}