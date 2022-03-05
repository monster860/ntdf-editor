export type Replacement = {type : "upper"|"lower"|"byte", offset : number, value : number}|{type : "range", offset : number, value : number[]};

function copy_replacement<T extends Replacement>(replacement : T) : T {
	if(replacement.type === "range") {
		return {...replacement, value: [...replacement.value]};
	}
	return {...replacement};
}

export async function apply_replacements_to_blob(blob : Blob, replacements : Replacement[]) {
	let ptr = 0;
	let parts : Array<Blob|ArrayBuffer> = [];
	for(let replacement of replacements) {
		if(replacement.offset < ptr) throw new Error("Replacements out of order!");
		if(replacement.offset > ptr) parts.push(blob.slice(ptr, replacement.offset));
		ptr = replacement.offset;
		if(replacement.type === "range") {
			parts.push(new Uint8Array(replacement.value).buffer);
			ptr += replacement.value.length;
		} else {
			let byte = replacement.value;
			if(replacement.type !== "byte") {
				let base = new Uint8Array(await blob.slice(ptr, ptr+1).arrayBuffer())[0];
				if(replacement.type === "lower") {
					byte = (base & 0xF0) | byte;
				} else {
					byte = (base & 0xF) | (byte << 4);
				}
			}
			parts.push(new Uint8Array([byte]).buffer);
			ptr++;
		}
	}
	if(blob.size > ptr) parts.push(blob.slice(ptr));
	return new Blob(parts);
}

export function add_replacement(replacements : Replacement[], addition : Replacement) : Replacement[] {
	if(replacements.length === 0) return [addition];
	if(addition.type === "range" && addition.value.length === 0) return replacements;
	let insert_location = replacements.length-1;
	replacements = [...replacements];
	for(let i = 0; i < replacements.length; i++) {
		let replacement = replacements[i];
		if(addition.offset < replacement.offset + (replacement.type === "range" ? replacement.value.length : 1)) {
			insert_location = i; break;
		}
	}
	let after_replacement = replacements[insert_location];
	if(addition.type !== "range" && after_replacement.type !== "range" && after_replacement.offset === addition.offset) {
		if(!(addition.type === after_replacement.type || addition.type === "byte")) {
			let value = after_replacement.value;
			if(after_replacement.type === "upper") value = value << 4;
			if(addition.type === "upper") value = (value & 0xF) | (addition.value << 4);
			else if(addition.type === "lower") value = (value & 0xF0) | (addition.value);
			addition = {type: "byte", offset: addition.offset, value};
		}
		replacements[insert_location] = addition;
	} else if(addition.type !== "range") {
		replacements.splice(insert_location, 0, addition);
	}
	if(addition.type !== "range") {
		if(addition.type !== "byte") return replacements;
		let next = replacements[insert_location+1] as Replacement|undefined;
		let prev = replacements[insert_location-1] as Replacement|undefined;
		if(prev && prev.type === "byte" && addition.offset === prev.offset+1) {
			prev = {type: "range", offset: prev.offset, value: [prev.value]};
		}
		if(next && next.type === "byte" && next.offset === addition.offset+1) {
			next = {type: "range", offset: next.offset, value: [next.value]};
		}
		if(prev && prev.type === "range" && addition.offset === prev.offset+prev.value.length) {
			let combined = copy_replacement(prev);
			let splice_count = 2;
			combined.value.push(addition.value);
			if(next && next.type === "range" && next.offset === addition.offset+1) {
				splice_count = 3;
				combined.value.push(...next.value);
			}
			replacements.splice(insert_location-1, splice_count, combined);
		} else if(next && next.type === "range" && next.offset === addition.offset+1) {
			let combined = copy_replacement(next);
			combined.value.splice(0, 0, addition.value);
			replacements.splice(insert_location, 2, combined);
		}
		return replacements;
	}
	throw new Error("Not supported adding range replacements yet... :(");
}