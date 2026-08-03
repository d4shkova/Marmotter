/**
 * The networks offered when adding one, and where to reach them.
 *
 * A directory rather than a handful of favourites. Somebody who already knows
 * which network they want should find it in a list, not have to look up its
 * address; somebody who does not should be able to read down one.
 *
 * `tls` is the network's own advice about the endpoint listed here, and decides
 * the security setting and port the form starts on. It is not a promise —
 * networks move ports, and the form stays editable — so nothing downstream
 * treats it as anything more than a starting point.
 *
 * Data only. No I/O, no React, and nothing here reaches the wire without
 * somebody choosing it first.
 */

export interface CatalogueNetwork {
  readonly id: string;
  /** As the network calls itself. */
  readonly name: string;
  readonly host: string;
  readonly port: number;
  /** Whether the listed port expects TLS. */
  readonly tls: boolean;
  /**
   * Whether it is offered at the top of the list.
   *
   * The large networks, plus the one this client is developed against. Everything
   * else is alphabetical below them, because a hundred and thirty names in
   * popularity order is a list nobody can find anything in.
   */
  readonly popular?: boolean;
}

export const NETWORKS: readonly CatalogueNetwork[] = [
  // The networks most people are looking for, in the order they are usually named.
  { id: 'dalnet', name: 'DALnet', host: 'irc.dal.net', port: 6697, tls: true, popular: true },
  { id: 'efnet', name: 'EFnet', host: 'irc.efnet.org', port: 6667, tls: false, popular: true },
  { id: 'ircnet', name: 'IRCnet', host: 'open.ircnet.net', port: 6667, tls: false, popular: true },
  {
    id: 'libera-chat',
    name: 'Libera.Chat',
    host: 'irc.libera.chat',
    port: 6697,
    tls: true,
    popular: true,
  },
  {
    id: 'quakenet',
    name: 'Quakenet',
    host: 'irc.quakenet.org',
    port: 6667,
    tls: false,
    popular: true,
  },
  { id: 'rizon', name: 'Rizon', host: 'irc.rizon.net', port: 6697, tls: true, popular: true },
  { id: 'snoonet', name: 'Snoonet', host: 'irc.snoonet.org', port: 6697, tls: true, popular: true },
  {
    id: 'swiftirc',
    name: 'SwiftIRC',
    host: 'irc.swiftirc.net',
    port: 6667,
    tls: false,
    popular: true,
  },
  {
    id: 'undernet',
    name: 'Undernet',
    host: 'irc.undernet.org',
    port: 6667,
    tls: false,
    popular: true,
  },
  {
    id: 'dashkova',
    name: 'dashkova.co.uk',
    host: 'irc.dashkova.co.uk',
    port: 6697,
    tls: true,
    popular: true,
  },

  // Everything else, alphabetically.
  { id: '2600net', name: '2600net', host: 'irc.scuttled.net', port: 6697, tls: true },
  { id: 'abjects', name: 'Abjects', host: 'irc.abjects.net', port: 6667, tls: false },
  { id: 'afternet', name: 'AfterNET', host: 'irc.afternet.org', port: 6697, tls: true },
  { id: 'aitvaras', name: 'Aitvaras', host: 'irc.data.lt', port: 6667, tls: false },
  { id: 'allnetwork', name: 'AllNetwork', host: 'irc.allnetwork.org', port: 6667, tls: false },
  { id: 'alphachat', name: 'AlphaChat', host: 'irc.alphachat.net', port: 6697, tls: true },
  { id: 'atrum', name: 'Atrum', host: 'irc.atrum.org', port: 6667, tls: false },
  { id: 'austnet', name: 'AustNet', host: 'irc.austnet.org', port: 6667, tls: false },
  { id: 'axon', name: 'Axon', host: 'irc.axon.pw', port: 6667, tls: false },
  { id: 'ayochat', name: 'AyoChat', host: 'irc.ayochat.or.id', port: 6667, tls: false },
  { id: 'azzurra', name: 'Azzurra', host: 'irc.azzurra.chat', port: 6697, tls: true },
  { id: 'beyondirc', name: 'Beyondirc', host: 'irc.beyondirc.net', port: 6667, tls: false },
  { id: 'bolchat', name: 'BOLChat', host: 'irc.bolchat.com', port: 6667, tls: false },
  { id: 'bongster', name: 'Bongster', host: 'ssl.bongster.de', port: 9666, tls: true },
  { id: 'brasirc', name: 'BrasIRC', host: 'irc.brasirc.com.br', port: 6667, tls: false },
  { id: 'canternet', name: 'CanterNet', host: 'irc.canternet.org', port: 6697, tls: true },
  { id: 'chat4all', name: 'Chat4all', host: 'irc.chat4all.org', port: 6667, tls: false },
  { id: 'chatspike', name: 'ChatSpike', host: 'irc.chatspike.net', port: 6667, tls: false },
  { id: 'chatzona', name: 'ChatZona', host: 'irc.chatzona.org', port: 6667, tls: false },
  { id: 'cncirc', name: 'CnCIRC', host: 'irc.cncirc.net', port: 6667, tls: false },
  { id: 'coolsmile', name: 'Coolsmile', host: 'irc.coolsmile.net', port: 6667, tls: false },
  { id: 'darenet', name: 'DareNET', host: 'irc.darenet.org', port: 6697, tls: true },
  { id: 'dark-tou-net', name: 'Dark-Tou-Net', host: 'irc.d-t-net.de', port: 6667, tls: false },
  { id: 'darkfasel-net', name: 'darkfasel.net', host: 'irc.darkfasel.net', port: 6697, tls: true },
  { id: 'darkmyst', name: 'DarkMyst', host: 'irc.darkmyst.org', port: 6697, tls: true },
  { id: 'darkscience', name: 'darkscience', host: 'irc.darkscience.net', port: 6697, tls: true },
  { id: 'darkworld', name: 'Darkworld', host: 'irc.darkworld.network', port: 6697, tls: true },
  { id: 'dejatoons', name: 'DejaToons', host: 'irc.dejatoons.net', port: 6667, tls: false },
  { id: 'desirenet', name: 'DesireNET', host: 'irc.desirenet.org', port: 6667, tls: false },
  { id: 'ecnet', name: 'ECNet', host: 'irc.ecnet.org', port: 6667, tls: false },
  { id: 'epiknet', name: 'EpiKnet', host: 'irc.epiknet.org', port: 6697, tls: true },
  { id: 'espernet', name: 'EsperNet', host: 'irc.esper.net', port: 6697, tls: true },
  { id: 'euircnet', name: 'euIRCnet', host: 'irc.euirc.net', port: 6697, tls: true },
  { id: 'europnet', name: 'EuropNet', host: 'irc.europnet.org', port: 6667, tls: false },
  { id: 'evolu-net', name: 'Evolu.NET', host: 'irc.evolu.net', port: 6667, tls: false },
  {
    id: 'explosionirc',
    name: 'ExplosionIRC',
    host: 'irc.explosionirc.net',
    port: 6667,
    tls: false,
  },
  { id: 'fdfnet', name: 'FDFnet', host: 'irc.fdfnet.net', port: 6667, tls: false },
  { id: 'fefnet', name: 'FEFnet', host: 'irc.fef.net', port: 6667, tls: false },
  {
    id: 'financialchat',
    name: 'Financialchat',
    host: 'irc.financialchat.com',
    port: 6667,
    tls: false,
  },
  { id: 'forestnet', name: 'Forestnet', host: 'irc.forestnet.org', port: 6667, tls: false },
  { id: 'freeunibg', name: 'FreeUniBG', host: 'irc.FreeUniBG.eu', port: 6667, tls: false },
  { id: 'gamesurge', name: 'GameSurge', host: 'irc.gamesurge.net', port: 6667, tls: false },
  { id: 'geeknode', name: 'GeekNode', host: 'irc.geeknode.org', port: 6697, tls: true },
  { id: 'geekshed', name: 'GeekShed', host: 'irc.geekshed.net', port: 6697, tls: true },
  {
    id: 'german-elite',
    name: 'German-Elite',
    host: 'irc.german-elite.net',
    port: 6667,
    tls: false,
  },
  { id: 'gigairc', name: 'GigaIRC', host: 'irc.gigairc.net', port: 6667, tls: false },
  { id: 'gimpnet', name: 'GIMPNet', host: 'irc.gimp.org', port: 6697, tls: true },
  {
    id: 'globalgamers',
    name: 'GlobalGamers',
    host: 'irc.globalgamers.net',
    port: 6667,
    tls: false,
  },
  {
    id: 'goodchatting',
    name: 'GoodChatting',
    host: 'irc.goodchatting.com',
    port: 6667,
    tls: false,
  },
  { id: 'hackint', name: 'hackint', host: 'irc.hackint.org', port: 6697, tls: true },
  { id: 'hybridirc', name: 'HybridIRC', host: 'irc.hybridirc.com', port: 6697, tls: true },
  { id: 'icq-chat', name: 'ICQ-Chat', host: 'irc.icq-chat.com', port: 6667, tls: false },
  {
    id: 'immortal-anime',
    name: 'Immortal-Anime',
    host: 'irc.immortal-anime.net',
    port: 6667,
    tls: false,
  },
  { id: 'indymedia', name: 'Indymedia', host: 'irc.indymedia.org', port: 6697, tls: true },
  { id: 'irc-hispano', name: 'IRC-Hispano', host: 'irc.irc-hispano.org', port: 6667, tls: false },
  { id: 'irc2', name: 'IRC2', host: 'irc.irc2.hu', port: 6697, tls: true },
  { id: 'irc4fun', name: 'IRC4Fun', host: 'irc.irc4fun.net', port: 6667, tls: false },
  { id: 'ircgate-it', name: 'IRCGate.it', host: 'irc.ircgate.it', port: 6667, tls: false },
  { id: 'irchighway', name: 'IRCHighway', host: 'irc.irchighway.net', port: 6667, tls: false },
  { id: 'ircsource', name: 'IRCsource', host: 'irc.ircsource.net', port: 6667, tls: false },
  { id: 'irctoo', name: 'IRCtoo', host: 'irc.irctoo.net', port: 6667, tls: false },
  { id: 'ircube', name: 'IRCube', host: 'irc.ircube.org', port: 6667, tls: false },
  { id: 'ircworld', name: 'IrcWorld', host: 'irc.ircworld.org', port: 6667, tls: false },
  { id: 'irdsi', name: 'IRDSI', host: 'irc.irdsi.net', port: 6667, tls: false },
  { id: 'kampungchat', name: 'KampungChat', host: 'irc.kampungchat.org', port: 6667, tls: false },
  { id: 'knightirc', name: 'KnightIRC', host: 'irc.knightirc.net', port: 6667, tls: false },
  { id: 'kreynet', name: 'Kreynet', host: 'irc.krey.net', port: 6697, tls: true },
  { id: 'krono', name: 'Krono', host: 'irc.krono.net', port: 6667, tls: false },
  { id: 'librairc', name: 'LibraIRC', host: 'irc.librairc.net', port: 6667, tls: false },
  { id: 'lichtsnel', name: 'LichtSnel', host: 'irc.lichtsnel.nl', port: 6667, tls: false },
  { id: 'linknet', name: 'LinkNet', host: 'irc.link-net.be', port: 6697, tls: true },
  { id: 'luatic', name: 'Luatic', host: 'irc.luatic.net', port: 6697, tls: true },
  { id: 'maddshark', name: 'Maddshark', host: 'irc.maddshark.net', port: 6667, tls: false },
  { id: 'magicstar', name: 'MagicStar', host: 'irc.magicstar.net', port: 6667, tls: false },
  { id: 'magnet', name: 'MagNET', host: 'irc.perl.org', port: 6667, tls: false },
  { id: 'mibbit', name: 'Mibbit', host: 'irc.mibbit.net', port: 6667, tls: false },
  { id: 'mindforge', name: 'MindForge', host: 'irc.mindforge.org', port: 6667, tls: false },
  { id: 'nationchat', name: 'NationCHAT', host: 'irc.nationchat.org', port: 6667, tls: false },
  { id: 'nightstar', name: 'NightStar', host: 'irc.nightstar.net', port: 6667, tls: false },
  { id: 'nullirc', name: 'NullIRC', host: 'irc.nullirc.net', port: 6697, tls: true },
  { id: 'oftc', name: 'OFTC', host: 'irc.oftc.net', port: 6697, tls: true },
  { id: 'oltreirc', name: 'OltreIrc', host: 'irc.oltreirc.net', port: 6667, tls: false },
  { id: 'openjoke', name: 'OpenJoke', host: 'irc.openjoke.org', port: 6667, tls: false },
  { id: 'optilan', name: 'OptiLan', host: 'irc.lt-tech.org', port: 6667, tls: false },
  { id: 'orixon', name: 'Orixon', host: 'irc.orixon.org', port: 6667, tls: false },
  { id: 'ozorg', name: 'OzOrg', host: 'irc.oz.org', port: 6667, tls: false },
  { id: 'p2p-net', name: 'P2P-NET', host: 'irc.p2p-network.net', port: 6667, tls: false },
  { id: 'phatnet', name: 'PhatNET', host: 'irc.phat-net.de', port: 6667, tls: false },
  { id: 'pik', name: 'PIK', host: 'irc.krstarica.com', port: 6697, tls: true },
  { id: 'pirc', name: 'PIRC', host: 'irc.pirc.pl', port: 6697, tls: true },
  { id: 'ptnet', name: 'PTnet', host: 'irc.ptnet.org', port: 6697, tls: true },
  {
    id: 'recycled-irc',
    name: 'Recycled-IRC',
    host: 'irc.recycled-irc.net',
    port: 6667,
    tls: false,
  },
  { id: 'retronode', name: 'RetroNode', host: 'irc.retroit.org', port: 6697, tls: true },
  { id: 'rezosup', name: 'Rezosup', host: 'irc.rezosup.org', port: 6667, tls: false },
  { id: 'rusnet', name: 'RusNet', host: 'irc.rusnet.org.ru', port: 6668, tls: false },
  { id: 'scarynet', name: 'ScaryNet', host: 'irc.scarynet.org', port: 6667, tls: false },
  {
    id: 'serenity-irc',
    name: 'Serenity-IRC',
    host: 'irc.serenity-irc.net',
    port: 6667,
    tls: false,
  },
  { id: 'shadowfire', name: 'ShadowFire', host: 'irc.shadowfire.org', port: 6667, tls: false },
  { id: 'shadowworld', name: 'ShadowWorld', host: 'irc.shadowworld.net', port: 6667, tls: false },
  { id: 'simosnap', name: 'SimosNap', host: 'irc.simosnap.com', port: 6697, tls: true },
  { id: 'skychatz', name: 'SkyChatz', host: 'irc.SkyChatz.org', port: 6667, tls: false },
  { id: 'skyrock', name: 'Skyrock', host: 'irc.skyrock.net', port: 6667, tls: false },
  { id: 'slacknet', name: 'Slacknet', host: 'irc.slacknet.org', port: 6667, tls: false },
  { id: 'slashnet', name: 'Slashnet', host: 'irc.slashnet.org', port: 6667, tls: false },
  { id: 'smurfnet', name: 'smurfnet', host: 'irc.smurfnet.ch', port: 6667, tls: false },
  { id: 'sorcerynet', name: 'SorceryNet', host: 'irc.sorcery.net', port: 6667, tls: false },
  { id: 'spotchat', name: 'SpotChat', host: 'irc.spotchat.org', port: 6697, tls: true },
  { id: 'st-city', name: 'ST-City', host: 'irc.st-city.net', port: 6667, tls: false },
  {
    id: 'starlink-irc',
    name: 'Starlink-irc',
    host: 'irc.starlink-irc.org',
    port: 6667,
    tls: false,
  },
  { id: 'starlink-org', name: 'StarLink.Org', host: 'irc.starlink.org', port: 6667, tls: false },
  { id: 'staynet', name: 'StayNet', host: 'irc.staynet.org', port: 6667, tls: false },
  { id: 'stormbit', name: 'StormBit', host: 'irc.stormbit.net', port: 6667, tls: false },
  { id: 'synirc', name: 'synIRC', host: 'irc.synirc.net', port: 6667, tls: false },
  { id: 'technet', name: 'TechNet', host: 'irc.technet.chat', port: 6697, tls: true },
  { id: 'tilde-chat', name: 'tilde.chat', host: 'irc.tilde.chat', port: 6697, tls: true },
  { id: 'tweakers', name: 'Tweakers', host: 'irc.tweakers.net', port: 6697, tls: true },
  { id: 'undermind', name: 'UnderMind', host: 'irc.undermind.net', port: 6667, tls: false },
  { id: 'wenet', name: 'WeNet', host: 'irc.wenet.ru', port: 6667, tls: false },
  { id: 'whatnet', name: 'WhatNet', host: 'irc.whatnet.org', port: 6667, tls: false },
  { id: 'wixchat', name: 'WixChat', host: 'irc.wixchat.org', port: 6667, tls: false },
  { id: 'worldirc', name: 'WorldIRC', host: 'irc.worldirc.org', port: 6667, tls: false },
  { id: 'xertion', name: 'Xertion', host: 'irc.xertion.org', port: 6697, tls: true },
  { id: 'xevion', name: 'Xevion', host: 'irc.xevion.net', port: 6667, tls: false },
];

/** A network by id, or undefined for one that is not in the directory. */
export function findNetwork(id: string): CatalogueNetwork | undefined {
  return NETWORKS.find((network) => network.id === id);
}

/** The ones offered first, then the rest, which is the order the picker shows. */
export const popularNetworks = (): readonly CatalogueNetwork[] =>
  NETWORKS.filter((network) => network.popular === true);

export const otherNetworks = (): readonly CatalogueNetwork[] =>
  NETWORKS.filter((network) => network.popular !== true);
