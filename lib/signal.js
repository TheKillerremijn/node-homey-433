'use strict';

const EventEmitter = require('events').EventEmitter;
const SignalManager = Homey.wireless('433').Signal;

const signals = new Map();

module.exports = class Signal extends EventEmitter {
	constructor(signalKey, parser, debounceTime) {
		super();
		this.payloadParser = parser || (payload => ({ payload: SignalManager.bitArrayToString(payload) }));
		this.debounceBuffer = new Map();
		this.debounceTimeout = Number(debounceTime) || 0;
		this.signalKey = signalKey;

		if (!signals.has(signalKey)) {
			const signal = new SignalManager(signalKey);
			Homey.log(`[Signal ${signalKey}] registered signal`);

			signal.register(err => { // Register signal
				if (err) this.emit('error', err);
			});

			signal.setMaxListeners(100);

			signal.on('payload', payload => Homey.log(`[Signal ${signalKey}] payload:`, payload.join('')));

			signals.set(signalKey, signal);
		}
		this.signal = signals.get(signalKey);

		this.signal.on('payload', payloadData => { // Start listening to payload event
			if (!this.manualDebounceFlag && !this.signal.manualDebounceFlag) {
				const payload = Array.from(payloadData).map(Number); // Copy array to prevent mutability issues with multiple drivers
				this.emit('payload', payload);
				// Only continue if the received data is valid
				if (!this.debounceTimeout > 0 || this.debounce(payload)) {
					const data = this.payloadParser(payload);
					if (!data || data.constructor !== Object || !data.id) return;
					this.emit('data', data);
				}
			} else {
				Homey.log(`[Signal ${this.signalKey}] Manually debounced payload:`, payloadData.join(''));
			}
		});
		this.signal.on('payload_send', this.emit.bind(this, 'payload_send'));
	}

	manualDebounce(timeout, allListeners) {
		if (allListeners) {
			this.signal.manualDebounceFlag = true;
			clearTimeout(this.signal.manualDebounceTimeout);
			this.signal.manualDebounceTimeout = setTimeout(() => this.signal.manualDebounceFlag = false, timeout);
		} else {
			this.manualDebounceFlag = true;
			clearTimeout(this.manualDebounceTimeout);
			this.manualDebounceTimeout = setTimeout(() => this.manualDebounceFlag = false, timeout);
		}
	}

	send(payload) {
		return new Promise((resolve, reject) => {
			const frameBuffer = new Buffer(payload);
			this.signal.tx(frameBuffer, (err, result) => { // Send the buffer to device
				if (err) { // Print error if there is one
					Homey.log(`[Signal ${this.signalKey}] sending payload failed:`, err);
					reject(err);
				} else {
					// FIXME TODO send payload in wallswitch test
					Homey.log(`[Signal ${this.signalKey}] send payload:`, payload.join(''));
					this.signal.emit('payload_send', payload);
					resolve(result);
				}
			});
		}).catch(err => {
			Homey.error(`[Signal ${this.signalKey}] tx error:`, err);
			this.emit('error', err);
			throw err;
		});
	}

	debounce(payload) {
		const payloadString = payload.join('');
		if (!this.debounceBuffer.has(payloadString)) {
			this.debounceBuffer.set(
				payloadString,
				setTimeout(() => this.debounceBuffer.delete(payloadString), this.debounceTimeout)
			);
			return payload;
		}
		return null;
	}
};
