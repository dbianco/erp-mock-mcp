/**
 * Rebuilds data/mobik/snapshot.json, the copy of Mobik's catalog the server answers with until its first successful
 * live read (and again if the store is down from the start). The trade-in table is deliberately left out. Run by hand:
 *
 *   npm run snapshot:mobik
 */
import { writeFileSync } from 'node:fs';
import { type Fetcher, fetchAccessories, fetchFaq, fetchPriceList } from '../src/tenants/mobik/sources.js';

const OUT = new URL('../data/mobik/snapshot.json', import.meta.url);
const fetcher: Fetcher = (url, init) => fetch(url, init);

const [priceList, accessories, faq] = await Promise.all([fetchPriceList(fetcher), fetchAccessories(fetcher), fetchFaq(fetcher)]);
const snapshot = { read_at: new Date().toISOString(), iphones: priceList.iphones, accessories, faq };
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`${priceList.iphones.length} iPhone listings and ${accessories.length} accessories and ${faq.length} FAQ entries written; trade-in table ${priceList.tradeIn === null ? 'NOT readable' : 'readable'}`);
