a vision for #GitViaNostr

# Intro

Git is a distributed version control system that has become the defacto standard for software development but overtime it has lost its distributed nature. Originally, Git utilized open, permissionless email for collaboration, which proved effective at scale. However, GitHub introduced a centralized pull request (PR) model that has since dominated the market.

Now, we have the opportunity to restore Git's permissionless and distributed nature through Nostr!

We have built tools to support Git collaboration via Nostr, but significant friction still exists that prevents widespread adoption. This article outlines a vision for how we can remove that friction and advance along the adoption curve.

First we will cover how far we have already come. Then we will proposed a pholosophy that should guide our next steps. Then we will talk about a vision to address specific challanges, mainly related to the role of the git server and CI / CD.

I am the lead mantainer of [ngit](https://gitworkshop.dev/dan@gitworkshop.dev/ngit) and [gitworkshop.dev](https://gitworkshop.dev/dan@gitworkshop.dev/gitworkshop) and I've been fortunate enough to be able to work full-time on this for the last 2 years via an OpenSats grant.

## How Far We Have Come

The purpose of #GitViaNostr is to liberate social discussions around code collaboration from permissioned walled gardens. At the beating heart of this collaboration is the process of how changes are proposed and applied. So, that's what we focused on first.

As nostr shares characteristics with email, and with NIP34, we have adopted similar primitives to those used in the patches-over-email workflow. In short, due to their simplicity and the fact that they do not rely on contributors hosting anything. This approach makes participation more accessible and reliable.

However, the fork-branch-PR-merge workflow is the only model most developers have ever known, and changing established workflows can be challenging. To address this, and based on feedback, we developed a new workflow that strikes a balance between familiarity, user experience, and alignment with the Nostr protocol: the [branch-PR-merge](https://gitworkshop.dev/quick-start) model.

This model is implemented by [ngit](https://gitworkshop.dev/ngit), which includes a Git plugin that allows users to engage without learning new commands. Additionally, [gitworkshop.dev](https://gitworkshop.dev) offers a GitHub-like interface for interacting with PRs and issues. We encourage you to try them out using the [quick start guide](https://gitworkshop.dev/quick-start) and share your feedback. You can also explore PRs and issues with [gitplaza](https://gitworkshop.dev/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza).

For those who appreciate the patches-over-email workflow, you can use that approach with Nostr through [gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us) or the `ngit send` and `ngit list` commands and explore patches with and [patch34](https://patch34.pages.dev).

[TODO: add segway:]
The tools to support the core collaboraiton challenge are now out there. still significant friction that prevents adoption.
[insert adoption curve diagram - at the innovators stage]

before we jump into that lets briefly talk pholopshy.

# Pholosophy

Before we dive into specific friction points lets discuss how we should approach things.

first, some underlying principles that I that I first published a few years ago:

- let git be git
- let nostr be nostr
- learn from success of others

but I'd like to add an extra one:

- lean into anarchy and resist monolthic development

## Micro clients FTW

Nostr is a cerebration of simplicity. lets not move away for that. monolthic developements trend towards complexity.
Ambitious projects like gitworkshop.dev, which seeks to cover broad aspects of the code collaboration experience, shouldn't stiffle great ideas and innovation.
We have seen just yesterday with the launch of following.space that vibe-coded micro clients can move the needle. They can be useful in their own right, shape the ecosystem and get features implemented in big and widely used clients.

The primatives in nip34 are simple and if there are any barriers to prevent the ability to vibe-code a #GitViaNostr app in an afternoon, we should get rid of them.

Micro clients should lead the way and explore new workflows, experiences, models of thinking.

An example of a new client pushing the needle related to code collaboration is kanbanstr.com. Its way more than a vibe-coded app and provides excellent project management features that work with great with software projects and support nip34 primatives like Issues.

The landscape of tools surounding code collaboration is board and there is lots of opporunities to innovate. Here are just a few:

- code
- proposed changes
- PR Reviews
- Issues
- Discussion
- CI / CD
- project management
- bounties and freelancing
- code snippets
- project discovery

may 1000 flowers bloom and 1000 more after them.

# friction and challenges

## The Git Server

In #GitViaNostr, maintainers' branches (e.g., `master`) are hosted on a Git server. Here’s why:

- **Follows the original Git vision** and the "let git be git" philosophy.
- **Super efficient**, battle-tested, and compatible with all the ways people use Git (e.g., LFS, shallow cloning).
- **Maintains compatibility** with related systems without the need for plugins (e.g., for build and deployment).
- **Only repository maintainers need write access.**

In the original Git model, all users would need to add the Git server as a 'git remote.' However, with ngit, the Git server is hidden behind a Nostr remote. This enables:

- **Hiding complexity** from contributors and users, so that only maintainers need to know about the Git server component to start using #GitViaNostr.
- **Maintainers can swap Git servers easily** by updating their announcement event, and contributors/users using ngit will automatically switch to the new one.

### Git Server Challenges

The need for a Git server presents several challenges:

- **Initial Setup**: When creating a new repository, the maintainer must select a Git server, which can be a jarring experience. Nearly all options, whether hosted or self-hosted, come bloated with social collaboration features tied to a centralized PR model, which are often difficult or impossible to turn off.
- **Manual Configuration**: New repositories require manual configuration, including adding new maintainers through a browser UI. This process can be cumbersome and time-consuming.

- **User Onboarding**: Many Git servers require email sign-up or KYC (Know Your Customer) processes, which can be a significant turn-off for new users exploring a decentralized and permissionless alternative to GitHub.

Once the initial setup is complete, the system works well if a reliable Git server is chosen. Unfortunately, that's a big "if," as we have become accustomed to the excellent uptime and reliability of GitHub. Even professionally run alternatives like Codeberg experience hours of downtime, which can be frustrating when CI/CD and deployment processes come to a halt. This problem is exacerbated when self-hosting.

Currently, nearly all repositories on Nostr use GitHub as the Git server. While maintainers can change servers at any point without disrupting their contributors, this reliance on a centralized service is not exactly the decentralized dream we aspire to achieve.

### Git Server Vision

The goal is to transform the Git server from a single point of truth and failure into a component similar to a Nostr relay.

#### Existing ngit Functionality

1. **State on Nostr**: Store the state of branches and tags in a Nostr event, removing reliance on a single server. This validates that the data received has been signed by the maintainer, ensuring the correct update has been sent and significantly reducing the trust requirement.

2. **Proxy to Multiple Git Servers**: Proxy requests to all servers listed in the announcement event. This adds redundancy and eliminates the need for any one server to match GitHub's reliability and uptime.

#### Nostr Git Server Implementation Requirements

To achieve this vision, the Nostr Git server implementation should:

1. **Implement the [Git Smart HTTP Protocol](https://git-scm.com/docs/http-protocol)** without authentication (no SSH) and only accept pushes if the reference tip matches the latest state event.

2. **Avoid Bloat**: There should be no user authentication, no database, no web UI, and no unnecessary features.

3. **Automatic Repository Management**: Accept or reject new repositories automatically upon the first push based on the content of the repository announcement event referenced in the URL path and its author.

Just as there are many free, paid, and self-hosted relays, there will be a variety of free, zero-step signup options, as well as self-hosted and paid solutions.

Some servers may use a Web of Trust (WoT) to filter out spam, while others might impose bandwidth or repository size limits for free tiers or whitelist specific npubs.

Additionally, some implementations could bundle relay and blossom server functionalities to unify the provision of repository data into a single service. These would likely only accept content related to the stored repositories rather than general social nostr content.

The potential role of CI / CD via nostr DVMs could create the incentives for a market of highly reliable free at the point of use git servers.

This could make onboarding #GitViaNostr repositories as easy as entering a name and selecting from a multi-select list of Git server providers that announce via NIP89.

[insert meme - https://i.imgflip.com/4/4rm35u.jpg with the following text]

1. nostr permissioned git server
2. no-kyc, zero-step signup
3. combined git / relay / blossom server
4. discovery via nip89 announcements
5. free at the point-of-use (subsided by CI/CD jobs)

## Git Client in the Browser

There are a range of tasks that are currently performed on a Git server web UI:

- Browse code, commits, branches, tags, etc.
- Create and display permalinks to specific lines in commits.
- Merge PRs.
- Make small commits and PRs on-the-fly.

Just as nobody goes to the web UI of a relay (e.g., [nos.lol](https://nos.lol)) to interact with notes, nobody should need to go to a Git server to interact with repositories. We use the Nostr protocol to interact with Nostr relays, and we should use the Git protocol to interact with Git servers. This situation has evolved due to the centralization of Git servers. Instead of being restricted to the view and experience designed by the server operator, users should be able to choose the user experience that works best for them from a range of clients.

To facilitate this, we need a library that lowers the barrier to entry for creating these experiences. This library should not require a full clone of every repository and should not depend on proprietary APIs. As a starting point, I propose wrapping the [WASM-compiled gitlib2](https://github.com/petersalomonsen/wasm-git) library for the web and creating useful functions, such as showing a file, which utilizes clever flags to minimize bandwidth usage (e.g., shallow clone, noblob, etc.).

This approach would not only enhance clients like gitworkshop.dev but also bring forth a vision where Git servers simply run the Git protocol, making vibe coding Git experiences even better.

## song

nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 created [song](https://gitworkshop.dev/fiatjaf.com/song) with a complementary vision that has shaped how I see the role of the git server. Its a self-hosted, nostr-permissioned git server with a relay baked in. Its currently a WIP and there are some compatability with ngit that we need to work out.

We collaborated on the nostr-permissioning approach now reflected in nip34.

I'm really excited to see how this space evolves.

# CI/CD

Most projects require CI/CD, and while this is often bundled with Git hosting solutions, it is currently not smoothly integrated into #GitViaNostr yet. There are many loosely coupled options, such as Jenkins, Travis, CircleCI, etc., that could be integrated with Nostr.

However, the more exciting prospect is to use DVMs (Data Vending Machines).

## DVMs for CI/CD

Nostr Data Vending Machines (DVMs) can provide a marketplace of CI/CD task runners with Cashu for micro payments.

There are various trust levels in CI/CD tasks:

- Tasks with no secrets eg. tests.
- Tasks using updatable secrets eg. API keys.
- Unverifiable builds and steps that sign with Android, Nostr, or PGP keys.

DVMs allow tasks to be kicked off with specific providers using a Cashu token as payment.

It might be suitable for some high-compute and easily verifiable tasks to be run by the cheapest available providers. Medium trust tasks could be run by providers with a good reputation, while high trust tasks could be run on self-hosted runners.

Job requests, status, and results all get published to Nostr for display in Git-focused Nostr clients.

Jobs could be triggered manually, or self-hosted runners could be configured to watch a Nostr repository and kick off jobs using their own runners without payment.

But I'm most excited about the prospect of Watcher Agents.

### CI/CD Watcher Agents

AI agents empowered with a NIP60 Cashu wallet can run tasks based on activity, such as a push to master or a new PR, using the most suitable available DVM runner that meets the user's criteria. To keep them running, anyone could top up their NIP60 Cashu wallet; otherwise, the watcher turns off when the funds run out. It could be users, maintainers, or anyone interested in helping the project who could top up the Watcher Agent's balance.

As aluded to earlier, part of building a reputation as a CI/CD provider could involve running reliable hosting (Git server, relay, and blossom server) for all FOSS Nostr Git repositories.

This provides a sustainable revenue model for hosting providers and creates incentives for many free-at-the-point-of-use hosting providers. This, in turn, would allow one-click Nostr repository creation workflows, instantly hosted by many different providers.

## Progress to Date

nostr:npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr and nostr:npub16ux4qzg4qjue95vr3q327fzata4n594c9kgh4jmeyn80v8k54nhqg6lra7 have been working on a runner that uses GitHub Actions YAML syntax (using act) for the [dvm-cicd-runner](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner) and takes Cashu payment. You can see [example runs on GitWorkshop](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner/actions). It currently takes testnuts, doesn't give any change, and the schema will likely change.

**Note**: The actions tab on GitWorkshop is currently available on all repositories if you turn on experimental mode (under settings in the user menu).

It's a work in progress, and we expect the format and schema to evolve.

## Easy Web App Deployment

For those disapointed not to find a 'Nostr' button to import a git repository to Vercel menu: take heart, they made it easy.
[vercel.com_import_options.png](./vercel.com_import_options.png)
there is a vercel cli that can be easily [called in CI / CD jobs to kick of deployments](https://vercel.com/docs/cli#using-in-a-ci/cd-environment). Not all managed solutions for web app deployment (eg. netlify) make it that easy.

# Many More Opportunities

## Large Patches via Blossom

I would be remiss not to mention the large patch problem. Some patches are too big to fit into Nostr events. Blossom is perfect for this, as it allows these larger patches to be included in a blossom file and referenced in a new patch kind.

Beyond this, there are many more opportunities to enhance #GitViaNostr. For instance, we can improve browsing, discovery, social and notifications. Receiving notifications on daily driver Nostr apps is one of the killer features of Nostr. However, we need to ensure that we can review Git-related notifications to avoid missing anything important.

We need tools that serve our curiosity. Tools that allow us to discover and follow projects, see discussions that might interest us, and stay updated on developments related to our work.

And we haven't even touched on the importance of search capabilities or discussed tools to assist with migrations.

The design space is huge. Its a lot of fun, so please join in!

# Concluding Thoughts

I would love your honest feedback on this vision and any ideas you might have. Your insights are invaluable as we work together to shape the future of #GitViaNostr.

## Contributions

I'll close with a list of people who have made code contributions related to #GitViaNostr this year:

Fiatjaf ([gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us), [song](https://gitworkshop.dev/naddr1qvzqqqrhnypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqy2hwumn8ghj7emfwshxv6tpw34xze3wvdhk6qqywdhkuecg7qylu), [patch34](https://patch34.pages.dev)), dluvian ([gitplaza](https://gitworkshop.dev/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza/prs))

nostr:npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume (ngit contributions, [git-remote-blossom](https://gitworkshop.dev/naddr1qvzqqqrhnypzpn7hma38nx3zuwz2f26a4rzqymy8tvge6r68cfckkgxd4jwvrudxqy28wumn8ghj7un9d3shjtnwdaehgu3wdp6sqyn8d96z6un9d4hhgefdvfkx7umndaks2fzhtl)),nostr:npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw ([SatShoot](https://satshoot.com), [Flotilla-Budabit](https://budabit.org)), nostr:npub1ehhfg09mr8z34wz85ek46a6rww4f7c7jsujxhdvmpqnl5hnrwsqq2szjqv (Flotilla-Budabit, [Nostr Git Extension](https://github.com/chebizarro/nostr-git-extension)), Randy McMillan ([gnostr](https://github.com/gnostr-org) and experiments), and others.

nostr:npub1uplxcy63up7gx7cladkrvfqh834n7ylyp46l3e8t660l7peec8rsd2sfek ([git-remote-nostr](https://github.com/gugabfigueiredo/git-remote-nostr))

Project Management
nostr:npub1ltx67888tz7lqnxlrg06x234vjnq349tcfyp52r0lstclp548mcqnuz40t ([kanbanstr](https://kanbanstr.com))
Code Snippets
nostr:npub1ygzj9skr9val9yqxkf67yf9jshtyhvvl0x76jp5er09nsc0p3j6qr260k2 ([nodebin.io](https://nodebin.io))
nostr:npub1r0rs5q2gk0e3dk3nlc7gnu378ec6cnlenqp8a3cjhyzu6f8k5sgs4sq9ac ([snipsnip.dev](https://snipsnip.dev))

CI / CD
nostr:npub16ux4qzg4qjue95vr3q327fzata4n594c9kgh4jmeyn80v8k54nhqg6lra7, nostr:npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr

and for their nostr:npub1c03rad0r6q833vh57kyd3ndu2jry30nkr0wepqfpsm05vq7he25slryrnw, nostr:npub1qqqqqq2stely3ynsgm5mh2nj3v0nk5gjyl3zqrzh34hxhvx806usxmln03 and nostr:npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z for their testing, feedback, ideas and encouragement.

Thank you for your support and collaboration! Let me know if I've missed anyone.
