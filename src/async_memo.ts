/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";

export function useAsyncMemo<T, S>(cb : (source : S, prev_val : T|undefined, prev_source : S|undefined) => Promise<T>, source : S) {
	const [result, setResult] = useState({val: undefined as T|undefined, source : undefined as S|undefined});
	const source_ref = useRef<S>();

	useEffect(() => {
		source_ref.current = source;
		cb(source, result.val, result.source).then(val => {
			setResult((prev) => {
				if(source_ref.current === source && prev.source !== source) {
					return {val, source};
				}
				return prev;
			})
		}, err => {
			console.error(err);
		});
	}, [source]);

	return [result.val, result.source === source] as const;

}