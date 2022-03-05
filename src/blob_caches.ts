import { Chunk, ChunkFile, Gamefile, InstancedModelsChunk } from "ntdf-modding-toolkit";

export class BlobCaches {
	static chunk_file_cache = new WeakMap<Blob, Promise<ChunkFile>>();
	static chunk_cache = new WeakMap<Blob, Promise<Chunk>>();
	static instanced_models_cache = new WeakMap<Blob, Promise<InstancedModelsChunk>>();
	static gamefile_cache = new WeakMap<Blob, Gamefile>();

	static resolve_chunk_file(blob : Blob) : Promise<ChunkFile> {
		let file = this.chunk_file_cache.get(blob);
		if(file) return file;
		file = ChunkFile.from_blob(blob);
		this.chunk_file_cache.set(blob, file);
		return file;
	}

	static resolve_chunk(blob : Blob) : Promise<Chunk> {
		let chunk = this.chunk_cache.get(blob);
		if(chunk) return chunk;
		chunk = Chunk.from_blob(blob);
		this.chunk_cache.set(blob, chunk);
		return chunk;
	}

	static resolve_instanced_models(blob : Blob) : Promise<InstancedModelsChunk> {
		let models = this.instanced_models_cache.get(blob);
		if(models) return models;
		models = InstancedModelsChunk.from_blob(blob);
		this.instanced_models_cache.set(blob, models);
		return models;
	}
}
