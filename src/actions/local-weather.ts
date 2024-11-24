import { action, streamDeck, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, DidReceiveGlobalSettingsEvent } from "@elgato/streamdeck";
import { clear } from "console";
import { createSettingsStore } from '../store'
import { openweatherData } from '../client/open-weather'
import { LocalWeatherSettings, WeatherData } from '../types'

// These icons are part of the current OpenWeather API specification.
const VALID_ICONS = [
	'01d', '01n', '02d', '02n', '03d', '03n',
	'04d', '04n', '09d', '09n', '10d', '10n',
	'11d', '11n', '13d', '13n', '50d', '50n',
];

const settingsStore = createSettingsStore();

// TODO: replace global references to settings with references to settingsStore
const upsertSettings = function (newSettings: LocalWeatherSettings) {
	const currentSettings = settingsStore.get();

	const hasNewValue = currentSettings.refreshTime !== newSettings.refreshTime
		|| currentSettings.openweatherApiKey !== newSettings.openweatherApiKey
		|| currentSettings.latLong !== newSettings.latLong

	if (hasNewValue) {
		streamDeck.logger.info(`----------HASNEWVALUE ${newSettings.refreshTime}`);
		settingsStore.set(newSettings);
	}

	streamDeck.logger.info(`----------HASCURRENTVALUE ${currentSettings.refreshTime}`);
}

streamDeck.settings.onDidReceiveGlobalSettings((ev: DidReceiveGlobalSettingsEvent<LocalWeatherSettings>) => {
	streamDeck.logger.info(`----------DIDRECEIVEGLOBAL ${ev.settings.refreshTime}`);
	upsertSettings(ev.settings);
});

/**
 * An action class that displays current weather information when the current button is pressed.
 */
@action({ UUID: "com.luke-abel.local-weather.display-weather" })
export class DisplayWeather extends SingletonAction<LocalWeatherSettings> {
	/**
	 * The {@link SingletonAction.onWillAppear} event is useful for setting the
	 * visual representation of an action when it becomes visible.
	 * This could be due to the Stream Deck first starting up, or the user navigating between pages / folders etc.
	 */
	override async onWillAppear(ev: WillAppearEvent<LocalWeatherSettings>): Promise<void> {
		streamDeck.logger.info('----------ONWILLAPPEAR');
		const settings = await streamDeck.settings.getGlobalSettings() as LocalWeatherSettings;	
		upsertSettings(settings);
		return beginInterval(ev, settings.refreshTime, false);
	}

	/**
	 * Listens for the {@link SingletonAction.onKeyDown} event,
	 * which is emitted by Stream Deck when an action is pressed.
	 */
	override async onKeyDown(ev: KeyDownEvent<LocalWeatherSettings>): Promise<void> {
		streamDeck.logger.info('----------ONKEYDOWN');
		const settings = await streamDeck.settings.getGlobalSettings() as LocalWeatherSettings;	
		upsertSettings(settings);
		return beginInterval(ev, settings.refreshTime, true);
	}
}

/**
 * If configured, wraps setKeyInfo in an interval. Otherwise, simply passes-through to setKeyInfo.
 */
async function beginInterval(ev: WillAppearEvent|KeyDownEvent, refreshTime: number, clearRefresh: boolean) {
	let { intervalId } = await ev.action.getSettings() as LocalWeatherSettings;	
	const ms = getRefreshTimeMs(refreshTime);

	// Clear the auto-refresh, likely because the user has provided a new refreshTime.
	if (intervalId && clearRefresh) {
		streamDeck.logger.info(`----------CLEARINTERVAL ${intervalId}`);
		clearInterval(intervalId);
		intervalId = undefined;
	}

	// If refreshTime has been set and no interval has, start the interval with the refreshTime.
	if (ms > 0 && !intervalId) {
		streamDeck.logger.info('----------USEINTERVAL');
		streamDeck.logger.info(`----------MS ${ms}`);
		const clampedMs = clamp(ms, 300000, 36000000);
		streamDeck.logger.info(`----------CLAMPEDMS ${clampedMs}`);
		const intervalId = setInterval(setKeyInfo, clampedMs, ev, true, refreshTime)[Symbol.toPrimitive]();		;
		streamDeck.logger.info(`----------INTERVALID ${intervalId}`);
		ev.action.setSettings({ intervalId })
	}

	// Always update the weather. Even if the user has auto-refresh set, they can update the weather manually.
	streamDeck.logger.info('----------NOINTERVAL');
	return setKeyInfo(ev, false, refreshTime)
}

/**
 * Retrieve the user's provided interval setting, parsing the value.
 * If it is 0 or blank, return 0.
 * If between 5 and 60, and converting to milliseconds.
 */
function getRefreshTimeMs(refreshTime: number): number {
	streamDeck.logger.info(`----------SEC ${refreshTime}`);

	if (refreshTime > 4) {
		return clamp(refreshTime, 5, 60) * 60 * 1000;
	}

	return 0;
}

/**
 * Set the image and title of the key based on current weather information.
 */
async function setKeyInfo(ev: WillAppearEvent|KeyDownEvent, fromInterval: boolean, refreshTime: number): Promise<void> {
	if (fromInterval) {
		streamDeck.logger.info(`----------FROMINTERVAL ${refreshTime}`);
	}

	// streamDeck.logger.info(`----------PSUEDOFETCH`);
	// return ev.action.setTitle('PSUEDO');
	const { temperature, humidity, windspeed, icon } = await fetchWeather();
	if (VALID_ICONS.includes(icon)) {
		// TODO: add unknown icon
		ev.action.setImage(`imgs/actions/display-weather/${icon}`);
	}
	return ev.action.setTitle(generateTitle(temperature, humidity, windspeed));
}

/**
 * Gather weather information from API fetch.
 */
async function fetchWeather(): Promise<WeatherData> {
	const { openweatherApiKey, latLong } = await streamDeck.settings.getGlobalSettings() as LocalWeatherSettings;	
	return await openweatherData(openweatherApiKey, latLong);
}

/**
 * Generate formatted title containing weather information.
 */
function generateTitle(temp: number, humidity: number, windspeed: number): string {
	const roundedTemp = Math.round((temp || 0) * 10) / 10
	const roundedWind = Math.round((windspeed || 0) * 10) / 10
	return `${roundedTemp}°, ${humidity}%\n\n\n\n${roundedWind} mph`
}

function clamp(value: number, min: number, max: number) {
	return Math.max(Math.min(value, max), min);
}