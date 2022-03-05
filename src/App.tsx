import { ChevronLeft, Close, Folder } from '@mui/icons-material';
import { AppBar, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, Drawer, IconButton, Skeleton, Tab, Tabs, Toolbar, Tooltip } from '@mui/material';
import { fileOpen, fileSave } from 'browser-fs-access';
import { Gamefile } from 'ntdf-modding-toolkit';
import React from 'react';
import './App.css';
import { Editor } from './editors/Editor';
import { FileContextMenu } from './FileContextMenu';
import FilesPane from './FilesPane';
import { GamefilePath } from './path';

type AppState = {
	iso_blob : File|undefined;
	gamefile : Gamefile|undefined;
	gamefile_undo : Gamefile[];

	tabs : OpenTab[];
	current_tab : GamefilePath<any>|false;

	context_menu : {x:number, y:number, path:GamefilePath<any>, is_tab: boolean}|undefined;
	context_menu_open : boolean;

	error_popup : any;
	error_popup_open : boolean;

	ws : WebSocket|undefined;

	drawer_open : boolean;
}

type GamefileReplaceCallback = (gamefile : Gamefile, tabs : OpenTab[]) => Promise<Gamefile|{
	gamefile : Gamefile,
	tabs? : OpenTab[],
}|null>;

export interface AppCallbacks {
	edit_gamefile(cb : GamefileReplaceCallback) : Promise<void>;
	open_file(path : GamefilePath<any>) : void;
	set_tab_properties(path : GamefilePath<any>, title? : string, ready? : boolean) : void;
	open_context_menu(x:number, y:number, path:GamefilePath<any>, is_tab?: boolean) : void;
	show_error(error : any) : void;
}

export interface OpenTab {
	path : GamefilePath<any>;
	ready : boolean;
	title : string;
}

export class App extends React.Component<{}, AppState> implements AppCallbacks {
	constructor(props : {}) {
		super(props);
		this.state = {
			iso_blob: undefined,
			gamefile: undefined,
			gamefile_undo: [],
			tabs: [],
			current_tab: false,
			context_menu: undefined,
			context_menu_open: false,
			error_popup: undefined,
			error_popup_open: false,
			ws: undefined,
			drawer_open: true
		};
	}

	async edit_gamefile(cb : GamefileReplaceCallback) : Promise<void> {
		try {
			for(let i = 0; i < 20; i++) {
				let gamefile = this.state.gamefile;
				if(!gamefile) throw new Error("Cannot edit gamefile - null gamefile");
				let tabs = this.state.tabs;
				let replacement = await cb(gamefile, tabs);
				if(replacement === null) return;
				let replacement_gamefile = (replacement instanceof Gamefile) ? replacement : replacement.gamefile;
				let replacement_tabs = (replacement instanceof Gamefile) ? undefined : replacement.tabs;
				let success = await new Promise<boolean>(resolve => {
					this.setState(state => {
						if(gamefile && gamefile === state.gamefile && (!replacement_tabs || state.tabs === tabs)) {
							resolve(true);
							return {
								...state,
								gamefile: replacement_gamefile,
								gamefile_undo: [...state.gamefile_undo, state.gamefile],
								tabs: replacement_tabs ?? state.tabs
							};
						}
						resolve(false);
						return null;
					});
				});
				if(success) {
					return;
				}
			};
			throw new Error("Failed to edit gamefile - failed too many times");
		} catch(e) {
			this.show_error(e);
			throw e;
		}
	}

	open_gamefile = async () => {
		let file = await fileOpen([
			{
				description: 'Disk Image',
				extensions: ['.iso'],
			}
		]);
		console.log(file);
		let gamefile = await Gamefile.from_iso(file);
		this.setState(state => ({...state, iso_blob: file, gamefile, gamefile_undo: []}));
	}
	save_gamefile = async () => {
		let gamefile = this.state.gamefile;
		let iso_file = this.state.iso_blob;
		if(!gamefile || !iso_file) return;
		let replacement_iso = new File([await gamefile.patch_iso(iso_file)], iso_file.name, {type: iso_file.type});
		await fileSave(replacement_iso, {
			extensions: ['.iso']
		})
	}

	open_file(path : GamefilePath<any>) : void {
		console.log(path.toString());
		this.setState(state => {
			
			let tabs = state.tabs;
			let found = false;
			for(let i = 0; i < tabs.length; i++) {
				if(tabs[i].path.toString() === path.toString()) {
					path = tabs[i].path;
					found = true;
					break;
				}
			}
			if(!found) {
				tabs = [...state.tabs, {
					path,
					ready: false,
					title: ""
				}];
			}
			return {
				...state,
				current_tab: path,
				tabs
			};
		});
	}

	open_context_menu(x: number, y: number, path: GamefilePath<any>, is_tab = false): void {
		this.setState(state => ({
			...state,
			context_menu: {x,y,path,is_tab},
			context_menu_open: true
		}));
	}

	show_error(error: any): void {
		this.setState(state => ({
			...state,
			error_popup: error,
			error_popup_open: true
		}));
	}
	hide_error = () => {
		this.setState(state => ({...state, error_popup_open: false}));
	}

	set_tab_properties = (path : GamefilePath<any>, title? : string, ready? : boolean) => {
		this.setState(state => {
			let tabs = [...state.tabs];
			for(let i = 0; i < tabs.length; i++) {
				if(tabs[i].path === path) {
					tabs[i] = {...tabs[i], ready: ready ?? tabs[i].ready, title: title ?? tabs[i].title};
					return {...state, tabs};
				}
			}
			return null;
		});
	}

	handle_tab_change = (event : React.SyntheticEvent, new_value : GamefilePath<any>|false) => {
		this.setState(state => {
			return {...state, current_tab: new_value};
		});
	}

	undo() {
		this.setState(state => {
			if(!state.gamefile_undo.length) return null;
			let gamefile_undo = [...state.gamefile_undo];
			let gamefile = gamefile_undo.pop();
			return {
				...state,
				gamefile,
				gamefile_undo
			};
		})
	}

	global_keydown = (event : KeyboardEvent) => {
		if(event.code === "KeyZ" && event.ctrlKey && !event.defaultPrevented) {
			event.preventDefault();
			this.undo();
		}
	};

	handle_dev_server_message = (e : MessageEvent) => {
		if(typeof e.data === "string") {
			let json = JSON.parse(e.data);
			if(json.request_file) {
				let split = json.request_file.split(":");
				let type = split[0] ?? "";
				let index = +split[1] || 0;
				let blob : Blob = new Blob([]);
				try {
					if(type === "GAMEFILE") {
						blob = this.state.gamefile?.get_file(index) ?? blob;
					}
				} catch(e) {
					this.show_error(e);
				}
				let reader = new FileReader();
				reader.readAsDataURL(blob);
				reader.onload = () => {
					this.state.ws?.send(JSON.stringify({
						file_data_id: json.request_file,
						file_data: reader.result
					}));
				}
			}
		}
	} 

	connect_dev_server(addr : string) {
		let ws = new WebSocket(addr);
		ws.addEventListener("message", this.handle_dev_server_message);
		this.setState(state => {
			if(state.ws && state.ws !== ws) state.ws.close();
			return {...state, ws}
		})
	}

	componentDidMount() {
		window.addEventListener("keydown", this.global_keydown);
	}
	componentWillUnmount() {
		window.removeEventListener("keydown", this.global_keydown);
		this.state.ws?.close();
	}

	render() {
		return (
			<Box sx={{display: 'flex', maxWidth: '100%'}}>
				<Drawer
					variant="permanent"
					sx={{
						width: this.state.drawer_open ? 480 : 0,
						flexShrink: 0,
						'& .MuiDrawer-paper': {
							width: this.state.drawer_open ? 480 : 0,
							boxSizing: 'border-box'
						}
					}}
					open={this.state.drawer_open}
				>
					<FilesPane gamefile={this.state.gamefile} callbacks={this} open_path={this.state.current_tab || undefined} />
				</Drawer>
				<Box
					component="main"
					sx={{
						flexGrow: 1,
						maxWidth: this.state.drawer_open ? 'calc(100% - 480px)' : '100%',
						minHeight: '100vh',
						boxSizing: 'border-box',
						bgcolor: 'background.default',
						display: 'flex',
						flexDirection: 'column',
					}}
				>
					<AppBar position="static">
						<Toolbar>
							<IconButton edge="start" color="inherit" sx={{ mr: 2 }} onClick={() => {
								this.setState(state => ({...state, drawer_open: !state.drawer_open}));
							}}>
								{this.state.drawer_open ? <ChevronLeft/> : <Folder />}
							</IconButton>
							<Button onClick={this.open_gamefile}>Open</Button>
							<Button onClick={this.save_gamefile} disabled={!(this.state.gamefile && this.state.iso_blob)}>Save</Button>
							<Button onClick={() => {
								let addr = window.prompt("Enter websocket address");
								if(addr) this.connect_dev_server(addr);
							}}>Connect to Dev Server</Button>
						</Toolbar>
					</AppBar>
					
					<Box
						sx={{
							position: "sticky",
							alignSelf: "flex-start",
							top: 0,
							bgcolor: 'background.default',
							zIndex: 1,
							minWidth: '100%',
							borderBottom: this.state.tabs.length ? 1 : 0,
							borderColor: 'divider'
						}}
					>
						<Tabs
							value={this.state.current_tab}
							onChange={this.handle_tab_change}
							variant="scrollable"
							scrollButtons="auto"
						>
							{this.state.tabs.map(tab => {
								let path_string = tab.path.toString();
								return <Tab
									value={tab.path}
									label={
										<span>
											<Tooltip title={path_string} disableInteractive>
												{tab.ready ? <span>{tab.title}</span> : <Skeleton variant='text' width={50} sx={{display: 'inline-block'}} />}
											</Tooltip>
											<IconButton component="div" size="small" onClick={(event : React.SyntheticEvent) => {
												event.stopPropagation();

												this.setState(state => {
													for(let i = 0; i < state.tabs.length; i++) {
														if(state.tabs[i] === tab) {
															let without = [...state.tabs];
															without.splice(i, 1);
															return {...state, tabs: without, current_tab: state.current_tab === tab.path ? false : state.current_tab};
														}
													}
												});
											}}>
												<Close />
											</IconButton>
										</span>
									}
									onContextMenu={(e) => {
										e.preventDefault();
										this.open_context_menu(e.clientX, e.clientY, tab.path, true);
									}}
									key={path_string}
								/>
							})}
						</Tabs>
					</Box>
					{this.state.tabs.map(tab => {
						let path_string = tab.path.toString();
						if(!this.state.gamefile) return <></>
						return (
							<div
								style={{
									display: (tab.path === this.state.current_tab) ? undefined : 'none',
									flexGrow: 1,
								}}
								key={path_string}
							>
								<Editor
									callbacks={this}
									gamefile={this.state.gamefile}
									path={tab.path}
									visible={tab.path === this.state.current_tab}
								/>
							</div>
						)
					})}
				</Box>
				{this.state.context_menu_open && this.state.context_menu && this.state.gamefile && (
					<FileContextMenu
						callbacks={this}
						gamefile={this.state.gamefile}
						onClose={() => {this.setState(state => ({...state, context_menu_open: false}));}}
						open={this.state.context_menu_open}
						path={this.state.context_menu.path}
						x={this.state.context_menu.x}
						y={this.state.context_menu.y}
						exclude_open_self={this.state.context_menu.is_tab}
					/>
				)}
				{this.state.error_popup && (
					<Dialog open={this.state.error_popup_open} onClose={this.hide_error}>
						<DialogContent>
							<DialogContentText>
								<pre>
									{(this.state.error_popup instanceof Error ? this.state.error_popup.stack : undefined) ?? this.state.error_popup}
								</pre>
							</DialogContentText>
						</DialogContent>
						<DialogActions>
							<Button onClick={this.hide_error} autoFocus>Close</Button>
						</DialogActions>
					</Dialog>
				)}
			</Box>
		);
	}
}

export default App;
