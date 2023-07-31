export type Indexer<V, U> = (value: V) => U | undefined;

class Index<K, V, U> {
    private _indexer: Indexer<V, U>;
    private _indexToKeys: Map<U, K[]> = new Map();
    private _keysNum = 0;
    public constructor(indexer: Indexer<V, U>) {
        this._indexer = indexer;
    }

    public get keysNum(): number {
        return this._keysNum;
    }

    public get(indexValue: U): K[] | undefined {
        return this._indexToKeys.get(indexValue);
    }

    public add(key: K, value: V): void {
        const index: U | undefined = this._indexer(value);
        if (index === undefined) return;
        let keys = this._indexToKeys.get(index);
        if (!keys) {
            keys = [];
            this._indexToKeys.set(index, keys);
        }
        keys.push(key);
        ++this._keysNum;
    }

    public remove(key: K, value: V): void {
        const index: U | undefined = this._indexer(value);
        if (index === undefined) return;
        const storedKeys = this._indexToKeys.get(index);
        if (storedKeys === undefined) {
            return;
        }
        const filteredKeys = storedKeys.filter((storedKey) => storedKey !== key);
        this._keysNum -= storedKeys.length - filteredKeys.length;
        if (0 < filteredKeys.length) {
            this._indexToKeys.set(index, filteredKeys);
        } else {
            this._indexToKeys.delete(index);
        }
    }

    public *valueKeys(indexValue?: U): Generator<K, any, undefined> {
        if (!indexValue) return;
        const keys = this._indexToKeys.get(indexValue);
        if (!keys) return;
        for (const key of keys) {
            yield key;
        }
    }

    public keys(): IterableIterator<U> {
        return this._indexToKeys.keys();
    }
}

const EMPTY_ARRAY: unknown[] = [];

export class IndexedMap<K = any, V = any, U = any> implements Map<K, V> {
    private _entries: Map<K, V> = new Map();
    private _indexes: Map<string, Index<K, V, U>> = new Map();

    public getAllByIndex(indexKey: string, index: U): V[] {
        const indexes = this._indexes.get(indexKey);
        if (indexes === undefined) {
            return [];
        }
        const keys = indexes.get(index);
        if (keys === undefined) {
            return [];
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const result: V[] = keys.map((key) => this._entries.get(key)!);
        return result;
    }

    public clear(): void {
        this._entries.clear();
        this._indexes.clear();
    }

    public delete(key: K): boolean {
        const value = this._entries.get(key);
        if (value === undefined) {
            return false;
        }
        this._deleteIndexes(key, value);
        return this._entries.delete(key);
    }

    public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        this._entries.forEach(callbackfn);
    }

    public get(key: K): V | undefined {
        return this._entries.get(key);
    }

    public has(key: K): boolean {
        return this._entries.has(key);
    }

    public addIndex(indexKey: string, indexer: Indexer<V, U>): this {
        if (this._indexes.has(indexKey)) {
            throw new Error(`Index for indexKey: ${indexKey} is already added`);
        }
        const index = new Index<K, V, U>(indexer);
        this._indexes.set(indexKey, index);
        return this;
    }

    public removeIndex(indexKey: string): this {
        this._indexes.delete(indexKey);
        return this;
    }

    public set(key: K, value: V): this {
        const prevValue = this._entries.get(key);
        if (prevValue !== undefined) {
            this._deleteIndexes(key, prevValue);
        }
        this._entries.set(key, value);
        this._addIndexes(key, value);
        return this;
    }

    public get size(): number {
        return this._entries.size;
    }

    public [Symbol.iterator](): IterableIterator<[K, V]> {
        return this._entries.entries();
    }

    public entries(indexKey?: string, indexValue?: U): IterableIterator<[K, V]> {
        if (!indexKey !== !indexValue) throw new Error(`when indexKey is given indexValue must be provided too`);
        if (indexKey === undefined && indexValue === undefined) {
            return this._entries.entries();
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const index = this._indexes.get(indexKey!);
        if (!index) {
            return (EMPTY_ARRAY as [K, V][]).values();
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;
        const generator = function* (): Generator<[K, V], any, undefined> {
            const keys: IterableIterator<K> = index.valueKeys(indexValue);
            for (const key of keys) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const value = that._entries.get(key)!;
                yield [key, value];
            }
        };
        return generator();
    }

    public indexes(): IterableIterator<string> {
        return this._indexes.keys();
    }

    public getIndexSize(indexKey: string): number {
        const index = this._indexes.get(indexKey);
        if (index === undefined) {
            return 0;
        }
        return index.keysNum;
    }

    public indexKeys(indexKey: string): IterableIterator<U> {
        const index = this._indexes.get(indexKey);
        if (!index) {
            return (EMPTY_ARRAY as U[]).values();
        }
        return index.keys();
        
    }

    public keys(indexKey?: string, indexValue?: U): IterableIterator<K> {
        if (!indexKey !== !indexValue) throw new Error(`when indexKey is given indexValue must be provided too`);
        if (indexKey === undefined && indexValue === undefined) {
            return this._entries.keys();
        }
        const index = this._indexes.get(indexKey!);
        if (!index) {
            return (EMPTY_ARRAY as K[]).values();
        }
        return index.valueKeys(indexValue);
    }

    public values(indexKey?: string, indexValue?: U): IterableIterator<V> {
        if (!indexKey !== !indexValue) throw new Error(`when indexKey is given indexValue must be provided too`);
        if (indexKey === undefined && indexValue === undefined) {
            return this._entries.values();
        }
        const index = this._indexes.get(indexKey!);
        if (!index) {
            return (EMPTY_ARRAY as V[]).values();
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;
        const generator = function* (): Generator<V, any, undefined> {
            const keys: IterableIterator<K> = index.valueKeys(indexValue);
            for (const key of keys) {
                const value = that._entries.get(key);
                if (value !== undefined)
                    yield value;
            }
        };
        return generator();
    }

    public get [Symbol.toStringTag](): string {
        const result = Array.from(this.entries())
            .map(([key, value]) => {
                return `[key: ${key}: value: ${value}]`;
            })
            .join(", ");
        return result;
    }

    private _addIndexes(key: K, value: V): void {
        for (const index of this._indexes.values()) {
            index.add(key, value);
        }
    }

    private _deleteIndexes(key: K, value: V) {
        for (const index of this._indexes.values()) {
            index.remove(key, value);
        }
    }
}