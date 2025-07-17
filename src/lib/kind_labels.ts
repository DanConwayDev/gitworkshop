// hopefully this will get merged into nostr-tools
// gitworkshop.dev/fiatjaf.com/nostr-tools/prs/note1uekdpqj2dnf3exn08ykqfmvppuqn27g7hdpztu0gwfcru8q4270sw0e9aq

const KindLabels: { [kind: number]: string } = {};

export function kindLabel(kind: number): string | undefined {
	if (KindLabels[kind]) return KindLabels[kind];
	if (kind > 4999 && kind < 6000) return 'Job Request';
	if (kind > 5999 && kind < 7000) return 'Job Result';
	if (kind > 8999 && kind < 9031) return 'Group Control Events';
	if (kind > 38999 && kind < 39010) return 'Group Metadata Events';
	return undefined;
}

export const Metadata = 0;
export type Metadata = typeof Metadata;
KindLabels[Metadata] = 'Metadata';

export const ShortTextNote = 1;
export type ShortTextNote = typeof ShortTextNote;
KindLabels[ShortTextNote] = 'Short Text Note';

export const RecommendRelay = 2;
export type RecommendRelay = typeof RecommendRelay;
KindLabels[RecommendRelay] = 'Recommend Relay';

export const Follows = 3;
export type Follows = typeof Follows;
KindLabels[Follows] = 'Follows';

export const EncryptedDirectMessage = 4;
export type EncryptedDirectMessage = typeof EncryptedDirectMessage;
KindLabels[EncryptedDirectMessage] = 'Encrypted Direct Message';

export const EventDeletion = 5;
export type EventDeletion = typeof EventDeletion;
KindLabels[EventDeletion] = 'Event Deletion';

export const Repost = 6;
export type Repost = typeof Repost;
KindLabels[Repost] = 'Repost';

export const Reaction = 7;
export type Reaction = typeof Reaction;
KindLabels[Reaction] = 'Reaction';

export const BadgeAward = 8;
export type BadgeAward = typeof BadgeAward;
KindLabels[BadgeAward] = 'Badge Award';

export const ChatMessage = 9;
export type ChatMessage = typeof ChatMessage;
KindLabels[ChatMessage] = 'Chat Message';

export const GroupChatThreadedReply = 10;
export type GroupChatThreadedReply = typeof GroupChatThreadedReply;
KindLabels[GroupChatThreadedReply] = 'Group Chat Threaded Reply';

export const Thread = 11;
export type Thread = typeof Thread;
KindLabels[Thread] = 'Thread';

export const GroupThreadReply = 12;
export type GroupThreadReply = typeof GroupThreadReply;
KindLabels[GroupThreadReply] = 'Group Thread Reply';

export const Seal = 13;
export type Seal = typeof Seal;
KindLabels[Seal] = 'Seal';

export const PrivateDirectMessage = 14;
export type PrivateDirectMessage = typeof PrivateDirectMessage;
KindLabels[PrivateDirectMessage] = 'Private Direct Message';

export const FileMessage = 15;
export type FileMessage = typeof FileMessage;
KindLabels[FileMessage] = 'File Message';

export const GenericRepost = 16;
export type GenericRepost = typeof GenericRepost;
KindLabels[GenericRepost] = 'Generic Repost';

export const ReactionToWebsite = 17;
export type ReactionToWebsite = typeof ReactionToWebsite;
KindLabels[ReactionToWebsite] = 'Reaction to Website';

export const Picture = 20;
export type Picture = typeof Picture;
KindLabels[Picture] = 'Picture';

export const VideoEvent = 21;
export type VideoEvent = typeof VideoEvent;
KindLabels[VideoEvent] = 'Video Event';

export const ShortFormPortraitVideoEvent = 22;
export type ShortFormPortraitVideoEvent = typeof ShortFormPortraitVideoEvent;
KindLabels[ShortFormPortraitVideoEvent] = 'Short Form Portrait Video Event';

export const ChannelCreation = 40;
export type ChannelCreation = typeof ChannelCreation;
KindLabels[ChannelCreation] = 'Channel Creation';

export const ChannelMetadata = 41;
export type ChannelMetadata = typeof ChannelMetadata;
KindLabels[ChannelMetadata] = 'Channel Metadata';

export const ChannelMessage = 42;
export type ChannelMessage = typeof ChannelMessage;
KindLabels[ChannelMessage] = 'Channel Message';

export const ChannelHideMessage = 43;
export type ChannelHideMessage = typeof ChannelHideMessage;
KindLabels[ChannelHideMessage] = 'Channel Hide Message';

export const ChannelMuteUser = 44;
export type ChannelMuteUser = typeof ChannelMuteUser;
KindLabels[ChannelMuteUser] = 'Channel Mute User';

export const RequestToVanish = 62;
export type RequestToVanish = typeof RequestToVanish;
KindLabels[RequestToVanish] = 'Request to Vanish';

export const ChessPGN = 64;
export type ChessPGN = typeof ChessPGN;
KindLabels[ChessPGN] = 'Chess PGN';

export const MergeRequests = 818;
export type MergeRequests = typeof MergeRequests;
KindLabels[MergeRequests] = 'Merge Requests';

export const PollResponse = 1018;
export type PollResponse = typeof PollResponse;
KindLabels[PollResponse] = 'Poll Response';

export const Bid = 1021;
export type Bid = typeof Bid;
KindLabels[Bid] = 'Bid';

export const BidConfirmation = 1022;
export type BidConfirmation = typeof BidConfirmation;
KindLabels[BidConfirmation] = 'Bid Confirmation';

export const OpenTimestamps = 1040;
export type OpenTimestamps = typeof OpenTimestamps;
KindLabels[OpenTimestamps] = 'Open Timestamps';

export const GiftWrap = 1059;
export type GiftWrap = typeof GiftWrap;
KindLabels[GiftWrap] = 'Gift Wrap';

export const FileMetadata = 1063;
export type FileMetadata = typeof FileMetadata;
KindLabels[FileMetadata] = 'File Metadata';

export const Poll = 1068;
export type Poll = typeof Poll;
KindLabels[Poll] = 'Poll';

export const Comment = 1111;
export type Comment = typeof Comment;
KindLabels[Comment] = 'Comment';

export const LiveChatMessage = 1311;
export type LiveChatMessage = typeof LiveChatMessage;
KindLabels[LiveChatMessage] = 'Live Chat Message';

export const GitPatch = 1617;
export type GitPatch = typeof GitPatch;
KindLabels[GitPatch] = 'Git Patch';

export const GitIssue = 1621;
export type GitIssue = typeof GitIssue;
KindLabels[GitIssue] = 'Git Issue';

export const LegacyGiReply = 1622;
export type LegacyGiReply = typeof LegacyGiReply;
KindLabels[LegacyGiReply] = 'Legacy Git Issue Reply';

export const GitStatusOpen = 1630;
export type GitStatusOpen = typeof GitStatusOpen;
KindLabels[GitStatusOpen] = 'Git Status Open';

export const GitStatusApplied = 1631;
export type GitStatusApplied = typeof GitStatusApplied;
KindLabels[GitStatusApplied] = 'Git Status Applied';

export const GitStatusClosed = 1632;
export type GitStatusClosed = typeof GitStatusClosed;
KindLabels[GitStatusClosed] = 'Git Status Closed';

export const GitStatusDraft = 1633;
export type GitStatusDraft = typeof GitStatusDraft;
KindLabels[GitStatusDraft] = 'Git Status Draft';

export const ProblemTracker = 1971;
export type ProblemTracker = typeof ProblemTracker;
KindLabels[ProblemTracker] = 'Problem Tracker';

export const Report = 1984;
export type Report = typeof Report;
KindLabels[Report] = 'Report';

export const Reporting = 1984;
export type Reporting = typeof Reporting;
KindLabels[Reporting] = 'Reporting';

export const Label = 1985;
export type Label = typeof Label;
KindLabels[Label] = 'Label';

export const CommunityPostApproval = 4550;
export type CommunityPostApproval = typeof CommunityPostApproval;
KindLabels[CommunityPostApproval] = 'Community Post Approval';

export const RelayReview = 1986;
export type RelayReview = typeof RelayReview;
KindLabels[RelayReview] = 'Relay Review';

export const AIEmbedding = 1987;
export type AIEmbedding = typeof AIEmbedding;
KindLabels[AIEmbedding] = 'AI Embedding / Vector list';

export const Torrent = 2003;
export type Torrent = typeof Torrent;
KindLabels[Torrent] = 'Torrent';

export const TorrentComment = 2004;
export type TorrentComment = typeof TorrentComment;
KindLabels[TorrentComment] = 'Torrent Comment';

export const CoinjoinPool = 2022;
export type CoinjoinPool = typeof CoinjoinPool;
KindLabels[CoinjoinPool] = 'Coinjoin Pool';

export const JobRequest = 5999;
export type JobRequest = typeof JobRequest;
KindLabels[JobRequest] = 'Job Request';

export const JobResult = 6999;
export type JobResult = typeof JobResult;
KindLabels[JobResult] = 'Job Result';

export const JobFeedback = 7000;
export type JobFeedback = typeof JobFeedback;
KindLabels[JobFeedback] = 'Job Feedback';

export const ReservedCashuWalletTokens = 7374;
export type ReservedCashuWalletTokens = typeof ReservedCashuWalletTokens;
KindLabels[ReservedCashuWalletTokens] = 'Reserved Cashu Wallet Tokens';

export const CashuWalletTokens = 7375;
export type CashuWalletTokens = typeof CashuWalletTokens;
KindLabels[CashuWalletTokens] = 'Cashu Wallet Tokens';

export const CashuWalletHistory = 7376;
export type CashuWalletHistory = typeof CashuWalletHistory;
KindLabels[CashuWalletHistory] = 'Cashu Wallet History';

export const ZapGoal = 9041;
export type ZapGoal = typeof ZapGoal;
KindLabels[ZapGoal] = 'Zap Goal';

export const Nutzap = 9321;
export type Nutzap = typeof Nutzap;
KindLabels[Nutzap] = 'Nutzap';

export const TidalLogin = 9467;
export type TidalLogin = typeof TidalLogin;
KindLabels[TidalLogin] = 'Tidal Login';

export const ZapRequest = 9734;
export type ZapRequest = typeof ZapRequest;
KindLabels[ZapRequest] = 'Zap Request';

export const Zap = 9735;
export type Zap = typeof Zap;
KindLabels[Zap] = 'Zap';

export const Highlights = 9802;
export type Highlights = typeof Highlights;
KindLabels[Highlights] = 'Highlights';

export const Mutelist = 10000;
export type Mutelist = typeof Mutelist;
KindLabels[Mutelist] = 'Mutelist';

export const Pinlist = 10001;
export type Pinlist = typeof Pinlist;
KindLabels[Pinlist] = 'Pinlist';

export const RelayList = 10002;
export type RelayList = typeof RelayList;
KindLabels[RelayList] = 'Relay List';

export const BookmarkList = 10003;
export type BookmarkList = typeof BookmarkList;
KindLabels[BookmarkList] = 'Bookmark List';

export const CommunitiesList = 10004;
export type CommunitiesList = typeof CommunitiesList;
KindLabels[CommunitiesList] = 'Communities List';

export const PublicChatsList = 10005;
export type PublicChatsList = typeof PublicChatsList;
KindLabels[PublicChatsList] = 'Public Chats List';

export const BlockedRelaysList = 10006;
export type BlockedRelaysList = typeof BlockedRelaysList;
KindLabels[BlockedRelaysList] = 'Blocked Relays List';

export const SearchRelaysList = 10007;
export type SearchRelaysList = typeof SearchRelaysList;
KindLabels[SearchRelaysList] = 'Search Relays List';

export const UserGroups = 10009;
export type UserGroups = typeof UserGroups;
KindLabels[UserGroups] = 'User Groups';

export const PrivateEventRelayList = 10013;
export type PrivateEventRelayList = typeof PrivateEventRelayList;
KindLabels[PrivateEventRelayList] = 'Private Event Relay List';

export const InterestsList = 10015;
export type InterestsList = typeof InterestsList;
KindLabels[InterestsList] = 'Interests List';

export const NutzapMintRecommendation = 10019;
export type NutzapMintRecommendation = typeof NutzapMintRecommendation;
KindLabels[NutzapMintRecommendation] = 'Nutzap Mint Recommendation';

export const UserEmojiList = 10030;
export type UserEmojiList = typeof UserEmojiList;
KindLabels[UserEmojiList] = 'User Emoji List';

export const DirectMessageRelaysList = 10050;
export type DirectMessageRelaysList = typeof DirectMessageRelaysList;
KindLabels[DirectMessageRelaysList] = 'Direct Message Relays List';

export const UserServerList = 10063;
export type UserServerList = typeof UserServerList;
KindLabels[UserServerList] = 'User Server List';

export const FileServerPreference = 10096;
export type FileServerPreference = typeof FileServerPreference;
KindLabels[FileServerPreference] = 'File Server Preference';

export const CashuWalletEvent = 17375;
export type CashuWalletEvent = typeof CashuWalletEvent;
KindLabels[CashuWalletEvent] = 'Cashu Wallet Event';

export const LightningPubRPC = 21000;
export type LightningPubRPC = typeof LightningPubRPC;
KindLabels[LightningPubRPC] = 'Lightning Pub RPC';

export const ClientAuth = 22242;
export type ClientAuth = typeof ClientAuth;
KindLabels[ClientAuth] = 'Client Auth';

export const WalletRequest = 23194;
export type WalletRequest = typeof WalletRequest;
KindLabels[WalletRequest] = 'Wallet Request';

export const WalletResponse = 23195;
export type WalletResponse = typeof WalletResponse;
KindLabels[WalletResponse] = 'Wallet Response';

export const NostrConnect = 24133;
export type NostrConnect = typeof NostrConnect;
KindLabels[NostrConnect] = 'Nostr Connect';

export const BlobsStoredOnMediaServers = 24242;
export type BlobsStoredOnMediaServers = typeof BlobsStoredOnMediaServers;
KindLabels[BlobsStoredOnMediaServers] = 'Blobs Stored on Media Servers';

export const HTTPAuth = 27235;
export type HTTPAuth = typeof HTTPAuth;
KindLabels[HTTPAuth] = 'HTTP Auth';

export const Followsets = 30000;
export type Followsets = typeof Followsets;
KindLabels[Followsets] = 'Follow Sets';

export const Genericlists = 30001;
export type Genericlists = typeof Genericlists;
KindLabels[Genericlists] = 'Generic Lists';

export const Relaysets = 30002;
export type Relaysets = typeof Relaysets;
KindLabels[Relaysets] = 'Relay Sets';

export const Bookmarksets = 30003;
export type Bookmarksets = typeof Bookmarksets;
KindLabels[Bookmarksets] = 'Bookmark Sets';

export const Curationsets = 30004;
export type Curationsets = typeof Curationsets;
KindLabels[Curationsets] = 'Curation Sets';

export const VideoSets = 30005;
export type VideoSets = typeof VideoSets;
KindLabels[VideoSets] = 'Video Sets';

export const KindMuteSets = 30007;
export type KindMuteSets = typeof KindMuteSets;
KindLabels[KindMuteSets] = 'Kind Mute Sets';

export const ProfileBadges = 30008;
export type ProfileBadges = typeof ProfileBadges;
KindLabels[ProfileBadges] = 'Profile Badges';

export const BadgeDefinition = 30009;
export type BadgeDefinition = typeof BadgeDefinition;
KindLabels[BadgeDefinition] = 'Badge Definition';

export const Interestsets = 30015;
export type Interestsets = typeof Interestsets;
KindLabels[Interestsets] = 'Interest Sets';

export const CreateOrUpdateStall = 30017;
export type CreateOrUpdateStall = typeof CreateOrUpdateStall;
KindLabels[CreateOrUpdateStall] = 'Create or Update Stall';

export const CreateOrUpdateProduct = 30018;
export type CreateOrUpdateProduct = typeof CreateOrUpdateProduct;
KindLabels[CreateOrUpdateProduct] = 'Create or Update Product';

export const MarketplaceUIUX = 30019;
export type MarketplaceUIUX = typeof MarketplaceUIUX;
KindLabels[MarketplaceUIUX] = 'Marketplace UI/UX';

export const ProductSoldAsAuction = 30020;
export type ProductSoldAsAuction = typeof ProductSoldAsAuction;
KindLabels[ProductSoldAsAuction] = 'Product Sold as Auction';

export const LongFormArticle = 30023;
export type LongFormArticle = typeof LongFormArticle;
KindLabels[LongFormArticle] = 'Long-Form Article';

export const DraftLong = 30024;
export type DraftLong = typeof DraftLong;
KindLabels[DraftLong] = 'Draft Long-Form Content';

export const Emojisets = 30030;
export type Emojisets = typeof Emojisets;
KindLabels[Emojisets] = 'Emoji Sets';

export const ModularArticleHeader = 30040;
export type ModularArticleHeader = typeof ModularArticleHeader;
KindLabels[ModularArticleHeader] = 'Modular Article Header';

export const ModularArticleContent = 30041;
export type ModularArticleContent = typeof ModularArticleContent;
KindLabels[ModularArticleContent] = 'Modular Article Content';

export const ReleaseArtifactSets = 30063;
export type ReleaseArtifactSets = typeof ReleaseArtifactSets;
KindLabels[ReleaseArtifactSets] = 'Release Artifact Sets';

export const Application = 30078;
export type Application = typeof Application;
KindLabels[Application] = 'Application';

export const AppCurationSets = 30267;
export type AppCurationSets = typeof AppCurationSets;
KindLabels[AppCurationSets] = 'App Curation Sets';

export const LiveEvent = 30311;
export type LiveEvent = typeof LiveEvent;
KindLabels[LiveEvent] = 'Live Event';

export const UserStatuses = 30315;
export type UserStatuses = typeof UserStatuses;
KindLabels[UserStatuses] = 'User Statuses';

export const SlideSet = 30388;
export type SlideSet = typeof SlideSet;
KindLabels[SlideSet] = 'Slide Set';

export const ClassifiedListing = 30402;
export type ClassifiedListing = typeof ClassifiedListing;
KindLabels[ClassifiedListing] = 'Classified Listing';

export const DraftClassifiedListing = 30403;
export type DraftClassifiedListing = typeof DraftClassifiedListing;
KindLabels[DraftClassifiedListing] = 'Draft Classified Listing';

export const GitRepositoryAnnouncement = 30617;
export type GitRepositoryAnnouncement = typeof GitRepositoryAnnouncement;
KindLabels[GitRepositoryAnnouncement] = 'Git Repository Announcement';

export const GitRepositoryStateAnn = 30618;
export type GitRepositoryStateAnn = typeof GitRepositoryStateAnn;
KindLabels[GitRepositoryStateAnn] = 'Git Repository State Announcement';

export const WikiArticle = 30818;
export type WikiArticle = typeof WikiArticle;
KindLabels[WikiArticle] = 'Wiki Article';

export const Redirects = 30819;
export type Redirects = typeof Redirects;
KindLabels[Redirects] = 'Redirects';

export const DraftEvent = 31234;
export type DraftEvent = typeof DraftEvent;
KindLabels[DraftEvent] = 'Draft Event';

export const LinkSet = 31388;
export type LinkSet = typeof LinkSet;
KindLabels[LinkSet] = 'Link Set';

export const Feed = 31890;
export type Feed = typeof Feed;
KindLabels[Feed] = 'Feed';

export const Date = 31922;
export type Date = typeof Date;
KindLabels[Date] = 'Date-Based Calendar Event';

export const Time = 31923;
export type Time = typeof Time;
KindLabels[Time] = 'Time-Based Calendar Event';

export const Calendar = 31924;
export type Calendar = typeof Calendar;
KindLabels[Calendar] = 'Calendar';

export const CalendarEventRSVP = 31925;
export type CalendarEventRSVP = typeof CalendarEventRSVP;
KindLabels[CalendarEventRSVP] = 'Calendar Event RSVP';

export const Handlerrecommendation = 31989;
export type Handlerrecommendation = typeof Handlerrecommendation;
KindLabels[Handlerrecommendation] = 'Handler Recommendation';

export const Handlerinformation = 31990;
export type Handlerinformation = typeof Handlerinformation;
KindLabels[Handlerinformation] = 'Handler Information';

export const CommunityDefinition = 34550;
export type CommunityDefinition = typeof CommunityDefinition;
KindLabels[CommunityDefinition] = 'Community Definition';

export const SoftwareApplication = 32267;
export type SoftwareApplication = typeof SoftwareApplication;
KindLabels[SoftwareApplication] = 'Software Application';
