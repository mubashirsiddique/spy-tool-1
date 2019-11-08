import { VkApiError } from "./vk_api.js";
import { divCeil } from "./utils.js";

const MAX_POSTS = 100;
const MAX_COMMENTS = 100;
const MAX_REQUESTS_IN_EXECUTE = 25;

const isEPERM = (err) => err.code === 7;

class Reader {
    constructor(config) {
        this._config = config;
        this._cache = [];
        this._cachePos = 0;
        this._eof = false;
        this._globalOffset = 0;
    }

    _setEOF(reason) {
        if (!this._eof) {
            this._config.callback('postDiscoveryStop', reason);
            this._eof = true;
        }
    }

    async _repopulateCache() {
        const result = await this._config.session.apiRequest('wall.get', {
            owner_id: this._config.oid,
            offset: this._globalOffset,
            count: MAX_POSTS,
            v: '5.101',
        });

        // Let's explicitly copy the slice -- I don't trust modern JS engines not to introduce a
        // memory leak here.
        const newCache = [...this._cache.slice(this._cachePos)];

        for (const datum of result.items) {
            const isPinned = datum.is_pinned;
            if (datum.date < this._config.sinceTimestamp && !isPinned) {
                this._setEOF('timeLimitReached');
                break;
            }
            if (isPinned && this._config.ignorePinned)
                continue;
            //if (datum.marked_as_ads)
            //    continue;

            const value = {
                id: datum.id,
                offset: 0,
                total: datum.comments.count,
                date: datum.date,
                pinned: isPinned,
            };
            if (datum.from_id === this._config.uid) {
                // TODO pass the datum to the callback
                this._config.callback('found', {postId: datum.id, offset: -1});
                value.offset = value.total;
            }
            this._config.callback('infoAdd', value);
            newCache.push(value);
        }
        this._config.callback('infoFlush', null);

        this._cache = newCache;
        this._cachePos = 0;
        if (result.items.length < MAX_POSTS)
            this._setEOF('noNorePosts');
        this._globalOffset += result.items.length;
    }

    _advance(n) {
        const values = this._cache.slice(this._cachePos, this._cachePos + n);
        this._cachePos += n;
        return values;
    }

    async read(n) {
        while (true) {
            const available = this._cache.length - this._cachePos;
            if (available >= n)
                return {values: this._advance(n), eof: false};
            if (this._eof)
                return {values: this._advance(available), eof: true};
            await this._repopulateCache();
        }
    }
}

class HotGroup {
    constructor(config, reader, groupSize) {
        this._config = config;
        this._hotArray = [];
        this._eof = false;
        this._reader = reader;
        this._groupSize = groupSize;
    }

    async getCurrent() {
        while (this._hotArray.length < this._groupSize && !this._eof) {
            const {values, eof} = await this._reader.read(this._groupSize - this._hotArray.length);
            for (const value of values) {
                if (value.offset !== value.total)
                    this._hotArray.push(value);
            }
            this._eof = eof;
        }
        return this._hotArray;
    }

    decreaseCurrent(amountsById) {
        const newHotArray = [];
        for (let i = 0; i < this._hotArray.length; ++i) {
            const value = this._hotArray[i];
            const amount = amountsById[value.id];
            let expellThis = false;
            if (amount !== undefined && amount !== 0) {
                value.offset += amount;
                if (value.offset >= value.total) {
                    value.offset = value.total;
                    expellThis = true;
                }
                this._config.callback('infoUpdate', value);
            }
            if (!expellThis)
                newHotArray.push(value);
        }
        this._config.callback('infoFlush', null);
        this._hotArray = newHotArray;
    }
}

const scheduleBatch = hotArray => {
    const result = [];
    for (let offsetSummand = 0; ; offsetSummand += MAX_COMMENTS) {
        let pushedSomething = false;
        for (const value of hotArray) {
            const currentOffset = value.offset + offsetSummand;
            if (currentOffset >= value.total)
                continue;
            result.push({id: value.id, offset: currentOffset});
            pushedSomething = true;
            if (result.length === MAX_REQUESTS_IN_EXECUTE)
                break;
        }
        if (!pushedSomething || result.length === MAX_REQUESTS_IN_EXECUTE)
            break;
    }
    return result;
};

const foolProofExecute = async (config, params) => {
    const {response, errors} = await config.session.apiExecuteRaw(params);

    if (errors.length === 0)
        return response;

    if (Array.isArray(response) && response.length !== 0) {
        for (const error of errors)
            if (!isEPERM(error))
                throw error;
        return response;
    }

    throw errors[0];
};

const executeBatch = async (config, hotArray) => {
    const batch = scheduleBatch(hotArray);
    let code = `var i = 0, r = [];`
    code += `var d = [${batch.map(datum => datum.id).join(',')}];`;
    code += `var o = [${batch.map(datum => datum.offset).join(',')}];`
    code += `while (i < ${batch.length}) {`;
    code += ` r.push(API.wall.getComments({`;
    code += `  owner_id: ${config.oid}, post_id: d[i], count: ${MAX_COMMENTS},`;
    code += `  offset: o[i], need_likes: 0, extended: 1, thread_items_count: 10`;
    code += ` }).profiles@.id);`;
    code += ` i = i + 1;`;
    code += `}`;
    code += `return r;`;

    const executeResult = await foolProofExecute(config, {code: code, v: '5.101'});

    const amountsById = {};
    for (let i = 0; i < batch.length; ++i) {
        const datum = batch[i];
        const posterIds = executeResult[i];

        const oldAmount = amountsById[datum.id] || 0;

        if (posterIds.indexOf(config.uid) !== -1) {
            config.callback('found', {postId: datum.id, offset: datum.offset});
            amountsById[datum.id] = Infinity;
        } else {
            amountsById[datum.id] = oldAmount + MAX_COMMENTS;
        }
    }
    return amountsById;
};

export const findPosts = async (config) => {
    const reader = new Reader(config);
    const hotGroup = new HotGroup(config, reader, MAX_REQUESTS_IN_EXECUTE);

    while (true) {
        const hotArray = await hotGroup.getCurrent();
        if (hotArray.length === 0)
            break;
        let amountsById;
        try {
            amountsById = await executeBatch(config, hotArray);
        } catch (err) {
            if (!(err instanceof VkApiError))
                throw err;
            const firstValue = hotArray[0];
            try {
                amountsById = await executeBatch(config, [firstValue]);
            } catch (err2) {
                if (!(err2 instanceof VkApiError))
                    throw err2;
                config.callback('error', {postId: firstValue.id, error: err2});
                // Let's just skip this one.
                amountsById = {};
                amountsById[firstValue.id] = Infinity;
            }
        }
        hotGroup.decreaseCurrent(amountsById);
    }
};

const gatherStatsBatch = async (config, batch, result) => {
    let code = `var i = 0, r = [];`;
    code += `var d = [${batch.join(',')}];`;
    code += `while (i < ${batch.length}) {`;
    code += ` r.push(API.wall.get({owner_id: d[i], offset: 0, count: ${MAX_POSTS}}));`;
    code += ` i = i + 1;`;
    code += `}`;
    code += `return r;`;

    const executeResult = await foolProofExecute(config, {code: code, v: '5.101'});
    for (let i = 0; i < batch.length; ++i) {
        const ownerDatum = executeResult[i];
        const ownerId = batch[i];

        let totalComments = 0;
        let earliestTimestamp = Infinity;
        let latestTimestamp = -Infinity;
        for (const post of ownerDatum.items) {
            const isPinned = post.is_pinned;
            if (isPinned && config.ignorePinned)
                continue;
            totalComments += post.comments.count;
            if (!isPinned) {
                earliestTimestamp = Math.min(earliestTimestamp, post.date);
                latestTimestamp = Math.max(latestTimestamp, post.date);
            }
        }

        result[ownerId] = {
            timeSpan: latestTimestamp - earliestTimestamp,
            totalComments: totalComments,
        };
    }
}

export const gatherStats = async (config) => {
    const result = {};
    const oids = config.oids;
    let offset = 0;
    while (offset !== oids.length) {
        const batchSize = Math.min(oids.length - offset, MAX_REQUESTS_IN_EXECUTE);
        const batch = oids.slice(offset, offset + batchSize);
        await gatherStatsBatch(config, batch, result);
        offset += batchSize;
        config.callback('progress', {
            numerator: divCeil(offset, MAX_REQUESTS_IN_EXECUTE),
            denominator: divCeil(oids.length, MAX_REQUESTS_IN_EXECUTE),
        });
    }
    return result;
};
