import { EventEmitter } from 'events';
export type TypedEvents<T> = Omit<TypedEventEmitter<T>, 'emit'>;

export class TypedEventEmitter<T> extends EventEmitter {
	public constructor(
	) {
		super();
		this.setMaxListeners(Infinity);
	}

	public on<U extends Exclude<keyof T, number>>(type: U, listener: (data: T[U]) => void): this {
		super.on(type, listener);
		
		return this;
	}

	public off<U extends Exclude<keyof T, number>>(type: U, listener: (data: T[U]) => void): this {
		super.off(type, listener);
		
		return this;
	}

	public once<U extends Exclude<keyof T, number>>(type: U, listener: (data: T[U]) => void): this {
		super.once(type, listener);
		
		return this;
	}

	public addListener<U extends Exclude<keyof T, number>>(eventName: U, listener: (data: T[U]) => void): this {
		super.addListener(eventName, listener);
		
		return this;
	}

	public removeListener<U extends Exclude<keyof T, number>>(eventName: U, listener: (data: T[U]) => void): this {
		super.removeListener(eventName, listener);
		
		return this;
	}

	public removeAllListeners<U extends Exclude<keyof T, number>>(eventName: U): this {
		super.removeAllListeners(eventName);
		
		return this;
	}

	public emit<U extends Exclude<keyof T, number>>(type: U, data: T[U]): boolean {
		return super.emit(type, data);
	}

}
