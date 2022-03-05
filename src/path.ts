import { Chunk, ChunkFile, ChunkType, Gamefile, InstancedModelsChunk, SectorMapChunk, VagAudio } from "ntdf-modding-toolkit";
import { BlobCaches } from "./blob_caches";

export interface GamefilePath<T> {
	replace(gamefile : Gamefile, replacement : T) : Promise<Gamefile>;
	resolve(gamefile : Gamefile) : Promise<T>;
	toString() : string;
	readonly parent? : GamefilePath<unknown>;
}
export namespace GamefilePath {
	export const root : GamefilePath<Gamefile> = {
		replace(gamefile : Gamefile, replacement : Gamefile) {
			return Promise.resolve(replacement);
		},
		resolve(gamefile : Gamefile) {
			return Promise.resolve(gamefile);
		},
		toString() {
			return "root";
		}
	}

	export function infer_materials_source(path : GamefilePath<Chunk>) : GamefilePath<ChunkFile>|undefined {
		if(
			path instanceof GamefilePathChunk
			&& path.parent instanceof GamefilePathChunkFile
			&& path.parent.parent instanceof GamefilePathChunkBlob
			&& path.parent.parent.parent instanceof GamefilePathChunk
			&& path.parent.parent.parent.type === ChunkType.ModelList
		) {
			return infer_materials_source(path.parent.parent.parent);
		} else if(
			path instanceof GamefilePathInstancedModel
			&& path.parent instanceof GamefilePathInstancedModels
			&& path.parent.parent instanceof GamefilePathChunkBlob
		) {
			return infer_materials_source(path.parent.parent.parent);
		} else if(path instanceof GamefilePathChunk) {
			return path.parent;
		} else if(path instanceof GamefilePathSingleChunk) {
			if(path.parent instanceof GamefilePathBlobSlice) {
				let slice_parent : GamefilePath<Blob> = path.parent;
				while(slice_parent instanceof GamefilePathBlobSlice) {
					slice_parent = slice_parent.parent;
				}
				if(slice_parent instanceof GamefilePathChunkBlob && slice_parent.parent instanceof GamefilePathChunk) {
					return infer_materials_source(slice_parent.parent);
				}
				return undefined;
			}
			return new GamefilePathChunkFile(new GamefilePathFile(GamefilePath.root, 7));
		}
	}

	export function flatten(path : GamefilePath<any>|undefined) : GamefilePath<unknown>[] {
		let flattened : GamefilePath<unknown>[] = [];
		while(path) {
			flattened.push(path);
			path = path.parent;
		}
		return flattened.reverse();
	}

	export function is_gamefile(path : GamefilePath<any>|undefined) : path is GamefilePath<Gamefile> {
		return (path instanceof GamefilePathSubGamefile || path === root);
	}

	export function is_blob(path : GamefilePath<any>|undefined) : path is GamefilePath<Blob> {
		return (path instanceof GamefilePathBlobSlice || path instanceof GamefilePathChunkBlob || path instanceof GamefilePathFile);
	}

	export function is_chunk(path : GamefilePath<any>|undefined) : path is GamefilePath<Chunk> {
		return (path instanceof GamefilePathChunk || path instanceof GamefilePathSingleChunk || path instanceof GamefilePathInstancedModel);
	}

	export function is_chunk_file(path : GamefilePath<any>|undefined) : path is GamefilePath<ChunkFile> {
		return (path instanceof GamefilePathChunkFile);
	}

	export function is_instanced_models(path : GamefilePath<any>|undefined) : path is GamefilePath<InstancedModelsChunk> {
		return (path instanceof GamefilePathInstancedModels);
	}

	export function is_vag(path : GamefilePath<any>|undefined) : path is GamefilePath<VagAudio> {
		return (path instanceof GamefilePathVag);
	}
}

export class GamefilePathSubGamefile implements GamefilePath<Gamefile> {
	constructor(public readonly parent : GamefilePath<Blob>, public readonly sector_map_ref : GamefilePath<Chunk>) {}
	private cache = new WeakMap<Gamefile, Gamefile>();
	async replace(gamefile : Gamefile, replacement : Gamefile) {
		let sm_blob_path = new GamefilePathChunkBlob(this.sector_map_ref);
		let sm = await SectorMapChunk.from_blob(await sm_blob_path.resolve(gamefile));
		sm.sectors = [...replacement.sector_map.sectors];
		sm.sizes = [...replacement.sector_map.sizes];
		gamefile = await sm_blob_path.replace(gamefile, sm.to_blob());
		gamefile = await this.parent.replace(gamefile, replacement.blob);
		this.cache.set(gamefile, replacement);
		return gamefile;
	}
	async resolve(gamefile : Gamefile) {
		let resolved = this.cache.get(gamefile);
		if(resolved) return resolved;
		let sm_blob_path = new GamefilePathChunkBlob(this.sector_map_ref);
		let sm = await SectorMapChunk.from_blob(await sm_blob_path.resolve(gamefile));
		resolved = new Gamefile(await this.parent.resolve(gamefile), sm);
		this.cache.set(gamefile, resolved);
		return resolved;
	}
	toString() {
		return `${this.parent}.use_bls(${this.sector_map_ref})`;
	}
}

export class GamefilePathFile implements GamefilePath<Blob> {
	constructor(public readonly parent : GamefilePath<Gamefile>, public readonly index : number) {}
	async replace(gamefile : Gamefile, replacement : Blob) {
		let new_gamefile = await this.parent.resolve(gamefile);
		new_gamefile = new_gamefile.copy();
		new_gamefile.replace_file(this.index, replacement);
		return await this.parent.replace(gamefile, new_gamefile)
	}
	async resolve(gamefile : Gamefile) {
		return (await this.parent.resolve(gamefile)).get_file(this.index);
	}
	toString() {
		return `${this.parent}[${this.index}]`;
	}
}

export class GamefilePathChunkFile implements GamefilePath<ChunkFile> {
	constructor(public readonly parent : GamefilePath<Blob>) {}
	async replace(gamefile : Gamefile, replacement : ChunkFile) {
		let blob = replacement.to_blob();
		BlobCaches.chunk_file_cache.set(blob, Promise.resolve(replacement));
		return await this.parent.replace(gamefile, blob);
	}
	async resolve(gamefile : Gamefile) {
		return await BlobCaches.resolve_chunk_file(await this.parent.resolve(gamefile));
	}
	toString() {
		return `${this.parent}.as_chunk_file`;
	}
}

export class GamefilePathSingleChunk implements GamefilePath<Chunk> {
	constructor(public readonly parent : GamefilePath<Blob>) {}
	async replace(gamefile : Gamefile, replacement : Chunk) {
		let blob = replacement.to_blob();
		BlobCaches.chunk_cache.set(blob, Promise.resolve(replacement));
		return await this.parent.replace(gamefile, blob);
	}
	async resolve(gamefile : Gamefile) {
		return await BlobCaches.resolve_chunk(await this.parent.resolve(gamefile));
	}
	toString() {
		return `${this.parent}.as_chunk`
	}
}

export class GamefilePathChunk implements GamefilePath<Chunk> {
	constructor(public readonly parent : GamefilePath<ChunkFile>, public readonly type : number, public readonly id : number, public readonly index : number) {}
	async replace(gamefile : Gamefile, replacement : Chunk) {
		let chunk_file = (await this.parent.resolve(gamefile)).copy();
		let index = this.index;
		for(let i = 0; i < chunk_file.chunks.length; i++) {
			let chunk = chunk_file.chunks[i];
			if(chunk.id === this.id && chunk.type === this.type) {
				if(index > 0) index--;
				else {
					chunk_file.chunks[i] = replacement;
					return await this.parent.replace(gamefile, chunk_file);
				}
			}
		}
		throw new Error("Could not replace " + this.toString() + " - not found")
	}
	async resolve(gamefile : Gamefile) {
		return (await this.parent.resolve(gamefile)).get_chunk_by_id(this.type, this.id, this.index);
	}
	toString() {
		let type_str = ChunkType[this.type] ?? this.type;
		return `${this.parent}.chunk[${type_str}:${this.id ?? ""}:${this.index ?? ""}]`
	}
}

export class GamefilePathChunkBlob implements GamefilePath<Blob> {
	constructor(public readonly parent : GamefilePath<Chunk>) {}
	async replace(gamefile : Gamefile, replacement : Blob) {
		let chunk = (await this.parent.resolve(gamefile)).copy();
		chunk.contents = replacement;
		return await this.parent.replace(gamefile, chunk);
	}
	async resolve(gamefile : Gamefile) {
		return (await this.parent.resolve(gamefile)).contents;
	}
	toString() {
		return `${this.parent}.contents`;
	}
}

export class GamefilePathBlobSlice implements GamefilePath<Blob> {
	constructor(public readonly parent : GamefilePath<Blob>, public readonly start : number, public readonly end? : number) {}
	private slice_cache = new WeakMap<Blob,Blob>();
	async replace(gamefile : Gamefile, replacement : Blob) {
		let blob = (await this.parent.resolve(gamefile));
		let slice_size = blob.slice(this.start, this.end).size;
		if(slice_size < replacement.size) {
			throw new Error(`Could not replace ${this.toString()} - replacement blob size of ${replacement.size} exceeds slice size of ${slice_size}`);
		}
		let blob_replacement = new Blob([blob.slice(0, this.start), replacement, blob.slice(this.start+replacement.size)]);
		if(slice_size === replacement.size) this.slice_cache.set(blob_replacement, replacement);
		return this.parent.replace(gamefile, blob_replacement);
	}
	async resolve(gamefile : Gamefile) {
		let blob = (await this.parent.resolve(gamefile));
		let sliced = this.slice_cache.get(blob);
		if(!sliced) {
			sliced = blob.slice(this.start, this.end);
			this.slice_cache.set(blob, sliced);
		}
		return sliced;
	}
	toString() {
		return `${this.parent}.slice(${this.start}${this.end ? ","+this.end : ""})`;
	}
}

export class GamefilePathInstancedModels implements GamefilePath<InstancedModelsChunk> {
	constructor(public readonly parent : GamefilePath<Blob>) {}
	async replace(gamefile : Gamefile, replacement : InstancedModelsChunk) {
		return await this.parent.replace(gamefile, replacement.to_blob());
	}
	async resolve(gamefile : Gamefile) {
		return await BlobCaches.resolve_instanced_models(await this.parent.resolve(gamefile));
	}
	toString() {
		return `${this.parent}.as_instanced_models`;
	}
}

export class GamefilePathInstancedModel implements GamefilePath<Chunk> {
	constructor(public readonly parent : GamefilePath<InstancedModelsChunk>, public readonly index : number, public readonly is_lod = false) {}
	async replace(gamefile: Gamefile, replacement: Chunk): Promise<Gamefile> {
		let models = await this.parent.resolve(gamefile);
		models = models.copy();
		let entry = {...models.models[this.index]};
		models.models[this.index] = entry;
		if(!entry) throw new Error(`Cannot replace ${this} - model index ${this.index} does not exist`);
		if(this.is_lod) {
			entry.lod_model = replacement;
		} else {
			entry.model = replacement;
		}
		return await this.parent.replace(gamefile, models);
	}
	async resolve(gamefile: Gamefile): Promise<Chunk> {
		let models = await this.parent.resolve(gamefile);
		let entry = models.models[this.index];
		if(!entry) throw new Error(`Cannot resolve ${this} - model index ${this.index} does not exist`);
		if(this.is_lod) {
			if(!entry.lod_model) {
				throw new Error(`Cannot resolve ${this} - model index ${this.index} does not have a LOD model`);
			}
			return entry.lod_model;
		} else {
			return entry.model;
		}
	}

	toString() {
		return `${this.parent}.${this.is_lod ? "lod_model" : "model"}[${this.index}]`;
	}

}

export class GamefilePathVag implements GamefilePath<VagAudio> {
	constructor(public readonly parent : GamefilePath<Blob>) {}
	async replace(gamefile : Gamefile, replacement : VagAudio) : Promise<Gamefile> {
		return this.parent.replace(gamefile, replacement.to_blob());
	}
	async resolve(gamefile : Gamefile) : Promise<VagAudio> {
		return await VagAudio.from_blob(await this.parent.resolve(gamefile));
	}

	toString() {
		return `${this.parent}.as_vag`;
	}
}
