const map = new WeakMap<any, number>();
let ctr = 0;
export default function object_key(thing : any) {
	let key = map.get(thing);
	if(key !== undefined) return key;
	key = ctr++;
	map.set(thing, key);
	return key;
}