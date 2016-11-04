'use strict';

import { EventEmitter } from 'events';
import { toNewFormat, pickData } from './data-formatter';
import { Storage } from './storage';
import { FeatureInterface } from './feature';
import { resolve } from 'url';
import { get } from './request';

export default class Repository extends EventEmitter implements EventEmitter {
    private timer: NodeJS.Timer;
    private url: string;
    private storage: Storage;
    private etag: string;
    private requestId: string;
    private refreshInterval?: number;

    constructor (backupPath: string, url: string, requestId: string, refreshInterval?: number, StorageImpl = Storage) {
        super();
        this.url = url;
        this.refreshInterval = refreshInterval;
        this.requestId = requestId;

        this.storage = new StorageImpl(backupPath);
        this.storage.on('error', (err) => this.emit('error', err));
        this.storage.on('ready', () => this.emit('ready'));

        process.nextTick(() => this.fetch());
    }

    timedFetch() {
        if (this.refreshInterval != null && this.refreshInterval > 0) {
            this.timer = setTimeout(() => this.fetch(), this.refreshInterval);
            this.timer.unref();
        }
    }

    validateFeature (feature: FeatureInterface) {
        const errors : string[] = [];
        if (!Array.isArray(feature.strategies)) {
            errors.push(`feature.strategies should be an array, but was ${typeof feature.strategies}`);
        }

        if (typeof feature.enabled !== 'boolean') {
            errors.push(`feature.enabled should be an boolean, but was ${typeof feature.enabled}`);
        }

        if (errors.length > 0) {
            const err = new Error(errors.join(', '));
            this.emit('error', err);
        }
    }

    fetch () {
        const url = resolve(this.url, '/features');
        get({
            url,
            etag: this.etag,
            requestId: this.requestId,
        }, (error, res, body: string) => {
            // start timer for next fetch
            this.timedFetch();

            if (error) {
                return this.emit('error', error);
            }

            if (res.statusCode === 304) {
                // No new data
                return;
            }

            if (res.statusCode !== 200) {
                return this.emit('error', new Error('Response was not statusCode 200'));
            }

            try {
                const payload: any = JSON.parse(body);
                const data: any = pickData(toNewFormat(payload));
                const obj = data.features.reduce((o: Object, feature: FeatureInterface) => {
                    this.validateFeature(feature);
                    o[feature.name] = feature;
                    return o;
                }, {} as Object);
                this.storage.reset(obj);
                this.etag = res.headers.etag;
                this.emit('data');
            } catch (err) {
                this.emit('error', err);
            }
        });
    }

    stop () {
        clearInterval(this.timer);
        this.removeAllListeners();
        this.storage.removeAllListeners();
    }

    getToggle (name: string) : FeatureInterface {
        return this.storage.get(name);
    }
};
