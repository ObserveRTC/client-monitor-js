export default class MappedDeque<K = any, V = any> {
    private _indexToKeys: Map<number, K> = new Map();
    private _keyToIndexes: Map<K, number> = new Map();
    private _indexToValues: Map<number, V> = new Map();
    private _firstIndex: number = 0;
    private _lastIndex: number = 0;
    private _count: number = 0;
    
    public get(key: K): V | undefined {
        if (!this._keyToIndexes.has(key)) {
            return undefined;
        }
        const index = this._keyToIndexes.get(key);
        if (index === undefined) {
            // inconsistent
            return undefined;
        }
        const result = this._indexToValues.get(index);
        return result;
    }

    public remove(key: K): V | undefined {
        const index = this._keyToIndexes.get(key);
        if (index === undefined) {
            return undefined;
        }
        if (index === this._firstIndex) {
            return this.popFirst();
        }
        if (index === this._lastIndex) {
            return this.popLast();
        }
        this._indexToKeys.delete(index);
        this._keyToIndexes.delete(key);
        const result = this._indexToValues.get(index);
        this._indexToValues.delete(index);
        --this._count;
        return result;
    }

    public add(key: K, value: V): void {
        const prevIndex = this._keyToIndexes.get(key);
        if (prevIndex !== undefined) {
            this._indexToKeys.delete(prevIndex);
            this._indexToValues.delete(prevIndex);
        }
        this._indexToValues.set(this._lastIndex, value);
        this._indexToKeys.set(this._lastIndex, key);
        this._keyToIndexes.set(key, this._lastIndex);
        ++this._lastIndex;
        ++this._count;
    }

    public popFirst(): V | undefined {
        if (this._count < 1) {
            return undefined;
        }
        const firstIndex = this._findFirst();
        if (firstIndex === undefined) {
            return undefined;
        }
        if (this._firstIndex < firstIndex) {
            this._firstIndex = firstIndex;
        }
        this._indexToKeys.delete(this._firstIndex);
        const key = this._indexToKeys.get(this._firstIndex);
        if (key !== undefined) {
            this._keyToIndexes.delete(key);
        }
        const value = this._indexToValues.get(this._firstIndex);
        this._indexToValues.delete(this._firstIndex);
        if (this._firstIndex < this._lastIndex) {
            ++this._firstIndex;
        }
        --this._count;
        return value;
    }

    public popLast(): V | undefined {
        if (this._count < 1) {
            return undefined;
        }
        const lastIndex = this._findLast();
        if (lastIndex === undefined) {
            return undefined;
        }
        const key = this._indexToKeys.get(lastIndex);
        if (key !== undefined) {
            this._keyToIndexes.delete(key);
            this._indexToKeys.delete(lastIndex);
        }
        const value = this._indexToValues.get(lastIndex);
        this._indexToValues.delete(lastIndex);
        --this._count;
        if (this._firstIndex < lastIndex) {
            this._lastIndex = lastIndex - 1;
        } else {
            this._lastIndex = this._firstIndex;
        }
        return value;
    }

    peekFirst() {
        const nextHead = this._findFirst();
        if (nextHead === undefined) {
            return undefined;
        }
        if (this._firstIndex < nextHead) {
            this._firstIndex = nextHead;
        }
        return this._indexToValues.get(this._firstIndex);
    }

    public peekLast(): V | undefined {
        const lastIndex = this._findLast();
        if (lastIndex === undefined) {
            return undefined;
        }
        return this._indexToValues.get(lastIndex);
    }

    private _findFirst(): number | undefined {
        let start = this._firstIndex;
        do {
            const exists = this._indexToValues.has(start);
            if (exists) {
                return start;
            }
            if (start < this._lastIndex) {
                ++start;
                continue;
            }
            return undefined;
        } while (start <= this._lastIndex);
    }

    private _findLast(): number | undefined {
        let end = this._lastIndex;
        do {
            const exists = this._indexToValues.has(end);
            if (exists) {
                return end;
            }
            if (this._firstIndex < end) {
                --end;
                continue;
            }
            return undefined;
        } while (this._firstIndex <= end);
    }

    get size() {
        return this._count;
    }

    get isEmpty() {
        return this._count < 1;
    }
}
