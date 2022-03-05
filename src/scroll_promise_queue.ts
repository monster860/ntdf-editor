import React from "react";

type ScrollPromiseItem = {
	fn : () => Promise<unknown>,
	element_ref : React.RefObject<HTMLElement>,
	resolve : (arg : any) => void,
	reject : (arg : any) => void
};

export class ScrollPromiseQueue {
	private items : ScrollPromiseItem[] = [];
	private curr_processing = 0;
	constructor(
		public readonly ref : React.RefObject<HTMLElement>,
		public max_concurrent = 1,
	) {}

	add<T>(fn : () => Promise<T>, element_ref : React.RefObject<HTMLElement>) : Promise<T> {
		if(this.curr_processing < this.max_concurrent) {
			let promise = fn();
			this.curr_processing++;
			promise.then(this.item_done, this.item_done);
			return promise;
		}
		return new Promise((resolve, reject) => {
			this.items.push({
				fn, element_ref, resolve, reject
			});
		});
	}

	private item_done = () => {
		this.curr_processing--;
		while(this.curr_processing < this.max_concurrent) {
			let item = this.pop_next_item();
			if(!item) break;
			this.curr_processing++;
			let promise = item.fn();
			promise.then(item.resolve, item.reject);
			promise.then(this.item_done, this.item_done);
		}
	}

	private pop_next_item() {
		let parent_elem = this.ref.current;
		if(parent_elem && this.items.length > 1) {
			let parent_rect = parent_elem.getBoundingClientRect();
			for(let i = 0; i < this.items.length; i++) {
				let item = this.items[i];
				let elem = item.element_ref.current;
				if(!elem) continue;
				let rect = elem.getBoundingClientRect();
				if(rect.top < parent_rect.bottom && rect.bottom > parent_rect.top) {
					this.items.splice(i, 1);
					return item;
				}
			}
		}
		return this.items.shift();
	}
}
