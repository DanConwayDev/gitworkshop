<!-- FileIcon.svelte -->
<script>
	import Icon from '@iconify/svelte';

	let { path = '', isDirectory = false, className = 'w-5 h-5' } = $props();

	// Extract extension from path
	function getExtension(filePath) {
		const parts = filePath.split('.');
		return parts.length > 1 ? parts.pop().toLowerCase() : '';
	}

	// Comprehensive extension to icon mapping
	const extensionIcons = {
		// Documents
		pdf: 'vscode-icons:file-type-pdf',
		doc: 'vscode-icons:file-type-word',
		docx: 'vscode-icons:file-type-word',
		odt: 'vscode-icons:file-type-word',
		rtf: 'vscode-icons:file-type-word',
		tex: 'vscode-icons:file-type-tex',
		wpd: 'vscode-icons:file-type-word',

		// Spreadsheets
		xls: 'vscode-icons:file-type-excel',
		xlsx: 'vscode-icons:file-type-excel',
		ods: 'vscode-icons:file-type-excel',
		csv: 'vscode-icons:file-type-csv',
		tsv: 'vscode-icons:file-type-csv',

		// Presentations
		ppt: 'vscode-icons:file-type-powerpoint',
		pptx: 'vscode-icons:file-type-powerpoint',
		odp: 'vscode-icons:file-type-powerpoint',

		// Web Development
		html: 'vscode-icons:file-type-html',
		htm: 'vscode-icons:file-type-html',
		xhtml: 'vscode-icons:file-type-html',
		css: 'vscode-icons:file-type-css',
		scss: 'vscode-icons:file-type-scss',
		sass: 'vscode-icons:file-type-sass',
		less: 'vscode-icons:file-type-less',
		styl: 'vscode-icons:file-type-stylus',

		// JavaScript & TypeScript
		js: 'vscode-icons:file-type-js-official',
		mjs: 'vscode-icons:file-type-js-official',
		cjs: 'vscode-icons:file-type-js-official',
		ts: 'vscode-icons:file-type-typescript-official',
		tsx: 'vscode-icons:file-type-reactts',
		jsx: 'vscode-icons:file-type-reactjs',

		// Framework specific
		vue: 'vscode-icons:file-type-vue',
		svelte: 'vscode-icons:file-type-svelte',
		angular: 'vscode-icons:file-type-angular',

		// Backend languages
		py: 'vscode-icons:file-type-python',
		pyc: 'vscode-icons:file-type-python-compiled',
		pyo: 'vscode-icons:file-type-python-compiled',
		pyw: 'vscode-icons:file-type-python',
		java: 'vscode-icons:file-type-java',
		class: 'vscode-icons:file-type-java-class',
		jar: 'vscode-icons:file-type-jar',
		kt: 'vscode-icons:file-type-kotlin',
		kts: 'vscode-icons:file-type-kotlin',

		// Systems programming
		c: 'vscode-icons:file-type-c3',
		h: 'vscode-icons:file-type-c-header',
		cpp: 'vscode-icons:file-type-cpp3',
		cxx: 'vscode-icons:file-type-cpp3',
		cc: 'vscode-icons:file-type-cpp3',
		hpp: 'vscode-icons:file-type-cpp-header',
		hxx: 'vscode-icons:file-type-cpp-header',
		rs: 'vscode-icons:file-type-rust',
		go: 'vscode-icons:file-type-go',
		zig: 'vscode-icons:file-type-zig',

		// .NET
		cs: 'vscode-icons:file-type-csharp',
		csx: 'vscode-icons:file-type-csharp',
		vb: 'vscode-icons:file-type-vb',
		fs: 'vscode-icons:file-type-fsharp',
		fsx: 'vscode-icons:file-type-fsharp',
		fsi: 'vscode-icons:file-type-fsharp',

		// PHP & Web backends
		php: 'vscode-icons:file-type-php',
		php3: 'vscode-icons:file-type-php',
		php4: 'vscode-icons:file-type-php',
		php5: 'vscode-icons:file-type-php',
		phtml: 'vscode-icons:file-type-php',

		// Ruby
		rb: 'vscode-icons:file-type-ruby',
		erb: 'vscode-icons:file-type-erb',
		gemspec: 'vscode-icons:file-type-ruby',

		// Shell & Scripts
		sh: 'vscode-icons:file-type-shell',
		bash: 'vscode-icons:file-type-shell',
		zsh: 'vscode-icons:file-type-shell',
		fish: 'vscode-icons:file-type-shell',
		ps1: 'vscode-icons:file-type-powershell',
		psm1: 'vscode-icons:file-type-powershell',
		psd1: 'vscode-icons:file-type-powershell',
		bat: 'vscode-icons:file-type-bat',
		cmd: 'vscode-icons:file-type-bat',

		// Data formats
		json: 'vscode-icons:file-type-json',
		jsonc: 'vscode-icons:file-type-json',
		json5: 'vscode-icons:file-type-json',
		xml: 'vscode-icons:file-type-xml',
		yaml: 'vscode-icons:file-type-yaml',
		yml: 'vscode-icons:file-type-yaml',
		toml: 'vscode-icons:file-type-toml',
		ini: 'vscode-icons:file-type-ini',
		cfg: 'vscode-icons:file-type-config',
		conf: 'vscode-icons:file-type-config',
		properties: 'vscode-icons:file-type-properties',

		// Database
		sql: 'vscode-icons:file-type-sql',
		db: 'vscode-icons:file-type-db',
		sqlite: 'vscode-icons:file-type-sqlite',
		sqlite3: 'vscode-icons:file-type-sqlite',

		// Images
		jpg: 'vscode-icons:file-type-image',
		jpeg: 'vscode-icons:file-type-image',
		png: 'vscode-icons:file-type-image',
		gif: 'vscode-icons:file-type-image',
		webp: 'vscode-icons:file-type-image',
		svg: 'vscode-icons:file-type-svg',
		ico: 'vscode-icons:file-type-favicon',
		bmp: 'vscode-icons:file-type-image',
		tiff: 'vscode-icons:file-type-image',
		tif: 'vscode-icons:file-type-image',
		psd: 'vscode-icons:file-type-photoshop',
		ai: 'vscode-icons:file-type-ai',
		sketch: 'vscode-icons:file-type-sketch',
		fig: 'vscode-icons:file-type-figma',

		// Video
		mp4: 'vscode-icons:file-type-video',
		avi: 'vscode-icons:file-type-video',
		mkv: 'vscode-icons:file-type-video',
		mov: 'vscode-icons:file-type-video',
		wmv: 'vscode-icons:file-type-video',
		flv: 'vscode-icons:file-type-video',
		webm: 'vscode-icons:file-type-video',
		m4v: 'vscode-icons:file-type-video',
		mpg: 'vscode-icons:file-type-video',
		mpeg: 'vscode-icons:file-type-video',

		// Audio
		mp3: 'vscode-icons:file-type-audio',
		wav: 'vscode-icons:file-type-audio',
		flac: 'vscode-icons:file-type-audio',
		aac: 'vscode-icons:file-type-audio',
		ogg: 'vscode-icons:file-type-audio',
		wma: 'vscode-icons:file-type-audio',
		m4a: 'vscode-icons:file-type-audio',
		opus: 'vscode-icons:file-type-audio',

		// Archives
		zip: 'vscode-icons:file-type-zip',
		rar: 'vscode-icons:file-type-zip',
		tar: 'vscode-icons:file-type-zip',
		gz: 'vscode-icons:file-type-zip',
		bz2: 'vscode-icons:file-type-zip',
		'7z': 'vscode-icons:file-type-zip',
		xz: 'vscode-icons:file-type-zip',
		deb: 'vscode-icons:file-type-deb',
		rpm: 'vscode-icons:file-type-rpm',

		// Fonts
		ttf: 'vscode-icons:file-type-font',
		otf: 'vscode-icons:file-type-font',
		woff: 'vscode-icons:file-type-font',
		woff2: 'vscode-icons:file-type-font',
		eot: 'vscode-icons:file-type-font',

		// Other programming languages
		swift: 'vscode-icons:file-type-swift',
		m: 'vscode-icons:file-type-matlab',
		r: 'vscode-icons:file-type-r',
		R: 'vscode-icons:file-type-r',
		perl: 'vscode-icons:file-type-perl',
		pl: 'vscode-icons:file-type-perl',
		lua: 'vscode-icons:file-type-lua',
		dart: 'vscode-icons:file-type-dart',
		elm: 'vscode-icons:file-type-elm',
		clj: 'vscode-icons:file-type-clojure',
		cljs: 'vscode-icons:file-type-clojurescript',
		ex: 'vscode-icons:file-type-elixir',
		exs: 'vscode-icons:file-type-elixir',
		erl: 'vscode-icons:file-type-erlang',
		hrl: 'vscode-icons:file-type-erlang',
		scala: 'vscode-icons:file-type-scala',
		sc: 'vscode-icons:file-type-scala',

		// Markup & Documentation
		md: 'vscode-icons:file-type-markdown',
		mdx: 'vscode-icons:file-type-mdx',
		rst: 'vscode-icons:file-type-rest',
		adoc: 'vscode-icons:file-type-asciidoc',
		asciidoc: 'vscode-icons:file-type-asciidoc',

		// Configuration
		env: 'vscode-icons:file-type-dotenv',
		editorconfig: 'vscode-icons:file-type-editorconfig',
		prettierrc: 'vscode-icons:file-type-prettier',
		eslintrc: 'vscode-icons:file-type-eslint',
		babelrc: 'vscode-icons:file-type-babel',

		// Build tools
		gradle: 'vscode-icons:file-type-gradle',
		webpack: 'vscode-icons:file-type-webpack',
		rollup: 'vscode-icons:file-type-rollup',
		gulp: 'vscode-icons:file-type-gulp',
		grunt: 'vscode-icons:file-type-grunt',

		// Docker
		dockerfile: 'vscode-icons:file-type-docker',
		dockerignore: 'vscode-icons:file-type-docker',

		// CI/CD
		jenkinsfile: 'vscode-icons:file-type-jenkins',
		travis: 'vscode-icons:file-type-travis',
		appveyor: 'vscode-icons:file-type-appveyor',

		// VCS
		gitignore: 'vscode-icons:file-type-git',
		gitattributes: 'vscode-icons:file-type-git',
		gitmodules: 'vscode-icons:file-type-git',

		// Other
		log: 'vscode-icons:file-type-log',
		txt: 'vscode-icons:file-type-text',
		text: 'vscode-icons:file-type-text',
		todo: 'vscode-icons:file-type-todo',
		license: 'vscode-icons:file-type-license',
		licence: 'vscode-icons:file-type-license',
		makefile: 'vscode-icons:file-type-makefile',
		rake: 'vscode-icons:file-type-rake',
		cmake: 'vscode-icons:file-type-cmake',

		// Default fallback
		default: 'vscode-icons:default-file'
	};

	// Special file name mappings (case-insensitive)
	const fileNameIcons = {
		// Package managers
		'package.json': 'vscode-icons:file-type-npm',
		'package-lock.json': 'vscode-icons:file-type-npm',
		'yarn.lock': 'vscode-icons:file-type-yarn',
		'pnpm-lock.yaml': 'vscode-icons:file-type-pnpm',
		'composer.json': 'vscode-icons:file-type-composer',
		'composer.lock': 'vscode-icons:file-type-composer',
		gemfile: 'vscode-icons:file-type-gemfile',
		'gemfile.lock': 'vscode-icons:file-type-gemfile',
		pipfile: 'vscode-icons:file-type-pip',
		'pipfile.lock': 'vscode-icons:file-type-pip',
		'poetry.lock': 'vscode-icons:file-type-poetry',
		'requirements.txt': 'vscode-icons:file-type-pip',
		'cargo.toml': 'vscode-icons:file-type-cargo',
		'cargo.lock': 'vscode-icons:file-type-cargo',
		'go.mod': 'vscode-icons:file-type-go-mod',
		'go.sum': 'vscode-icons:file-type-go-mod',

		// Configuration files
		dockerfile: 'vscode-icons:file-type-docker2',
		'docker-compose.yml': 'vscode-icons:file-type-docker2',
		'docker-compose.yaml': 'vscode-icons:file-type-docker2',
		'.dockerignore': 'vscode-icons:file-type-docker',
		makefile: 'vscode-icons:file-type-makefile',
		'cmakelists.txt': 'vscode-icons:file-type-cmake',
		rakefile: 'vscode-icons:file-type-rake',
		'.gitignore': 'vscode-icons:file-type-git',
		'.gitattributes': 'vscode-icons:file-type-git',
		'.gitmodules': 'vscode-icons:file-type-git',
		'.gitconfig': 'vscode-icons:file-type-git',

		// Environment
		'.env': 'vscode-icons:file-type-dotenv',
		'.env.local': 'vscode-icons:file-type-dotenv',
		'.env.development': 'vscode-icons:file-type-dotenv',
		'.env.production': 'vscode-icons:file-type-dotenv',
		'.env.test': 'vscode-icons:file-type-dotenv',
		'.env.example': 'vscode-icons:file-type-dotenv',

		// Config files
		'.editorconfig': 'vscode-icons:file-type-editorconfig',
		'.prettierrc': 'vscode-icons:file-type-prettier',
		'.prettierrc.json': 'vscode-icons:file-type-prettier',
		'.prettierrc.js': 'vscode-icons:file-type-prettier',
		'.prettierrc.yaml': 'vscode-icons:file-type-prettier',
		'.prettierignore': 'vscode-icons:file-type-prettier',
		'.eslintrc': 'vscode-icons:file-type-eslint',
		'.eslintrc.json': 'vscode-icons:file-type-eslint',
		'.eslintrc.js': 'vscode-icons:file-type-eslint',
		'.eslintignore': 'vscode-icons:file-type-eslint',
		'.babelrc': 'vscode-icons:file-type-babel',
		'.babelrc.json': 'vscode-icons:file-type-babel',
		'babel.config.js': 'vscode-icons:file-type-babel',
		'tsconfig.json': 'vscode-icons:file-type-tsconfig',
		'jsconfig.json': 'vscode-icons:file-type-jsconfig',
		'webpack.config.js': 'vscode-icons:file-type-webpack',
		'rollup.config.js': 'vscode-icons:file-type-rollup',
		'vite.config.js': 'vscode-icons:file-type-vite',
		'vite.config.ts': 'vscode-icons:file-type-vite',
		'gulpfile.js': 'vscode-icons:file-type-gulp',
		'gruntfile.js': 'vscode-icons:file-type-grunt',

		// CI/CD
		'.travis.yml': 'vscode-icons:file-type-travis',
		'.gitlab-ci.yml': 'vscode-icons:file-type-gitlab',
		jenkinsfile: 'vscode-icons:file-type-jenkins',
		'bitbucket-pipelines.yml': 'vscode-icons:file-type-bitbucket',
		'.circleci/config.yml': 'vscode-icons:file-type-circleci',
		'azure-pipelines.yml': 'vscode-icons:file-type-azure-pipelines',
		'.github/workflows': 'vscode-icons:file-type-github',

		// Other
		readme: 'vscode-icons:file-type-readme',
		'readme.md': 'vscode-icons:file-type-readme',
		'readme.txt': 'vscode-icons:file-type-readme',
		license: 'vscode-icons:file-type-license',
		'license.md': 'vscode-icons:file-type-license',
		'license.txt': 'vscode-icons:file-type-license',
		copying: 'vscode-icons:file-type-license',
		changelog: 'vscode-icons:file-type-changelog',
		'changelog.md': 'vscode-icons:file-type-changelog',
		'history.md': 'vscode-icons:file-type-changelog',
		authors: 'vscode-icons:file-type-authors',
		contributors: 'vscode-icons:file-type-authors',
		todo: 'vscode-icons:file-type-todo',
		'todo.md': 'vscode-icons:file-type-todo',
		'.nvmrc': 'vscode-icons:file-type-node',
		'.node-version': 'vscode-icons:file-type-node',
		'.npmrc': 'vscode-icons:file-type-npm',
		'.npmignore': 'vscode-icons:file-type-npm',
		'.yarnrc': 'vscode-icons:file-type-yarn',
		'.yarnrc.yml': 'vscode-icons:file-type-yarn'
	};

	// Directory icons based on name
	const directoryIcons = {
		// Source code
		src: 'vscode-icons:folder-type-src',
		source: 'vscode-icons:folder-type-src',
		lib: 'vscode-icons:folder-type-lib',
		dist: 'vscode-icons:folder-type-dist',
		build: 'vscode-icons:folder-type-build',
		out: 'vscode-icons:folder-type-dist',
		bin: 'vscode-icons:folder-type-binary',

		// Web specific
		public: 'vscode-icons:folder-type-public',
		static: 'vscode-icons:folder-type-asset',
		assets: 'vscode-icons:folder-type-asset',
		images: 'vscode-icons:folder-type-images',
		img: 'vscode-icons:folder-type-images',
		styles: 'vscode-icons:folder-type-style',
		css: 'vscode-icons:folder-type-style',
		scss: 'vscode-icons:folder-type-style',
		scripts: 'vscode-icons:folder-type-script',
		js: 'vscode-icons:folder-type-script',

		// Components
		components: 'vscode-icons:folder-type-component',
		widgets: 'vscode-icons:folder-type-component',
		elements: 'vscode-icons:folder-type-component',

		// App structure
		pages: 'vscode-icons:folder-type-view',
		views: 'vscode-icons:folder-type-view',
		screens: 'vscode-icons:folder-type-view',
		layouts: 'vscode-icons:folder-type-layout',
		templates: 'vscode-icons:folder-type-template',

		// Backend
		api: 'vscode-icons:folder-type-api',
		routes: 'vscode-icons:folder-type-route',
		controllers: 'vscode-icons:folder-type-controller',
		models: 'vscode-icons:folder-type-model',
		services: 'vscode-icons:folder-type-service',
		utils: 'vscode-icons:folder-type-utils',
		helpers: 'vscode-icons:folder-type-helper',
		middleware: 'vscode-icons:folder-type-middleware',

		// Data
		data: 'vscode-icons:folder-type-db',
		database: 'vscode-icons:folder-type-db',
		db: 'vscode-icons:folder-type-db',
		migrations: 'vscode-icons:folder-type-db',
		seeds: 'vscode-icons:folder-type-db',

		// Config
		config: 'vscode-icons:folder-type-config',
		configs: 'vscode-icons:folder-type-config',
		settings: 'vscode-icons:folder-type-config',

		// Testing
		test: 'vscode-icons:folder-type-test',
		tests: 'vscode-icons:folder-type-test',
		__tests__: 'vscode-icons:folder-type-test',
		spec: 'vscode-icons:folder-type-test',
		specs: 'vscode-icons:folder-type-test',
		e2e: 'vscode-icons:folder-type-e2e',
		integration: 'vscode-icons:folder-type-test',
		unit: 'vscode-icons:folder-type-test',

		// Documentation
		docs: 'vscode-icons:folder-type-docs',
		documentation: 'vscode-icons:folder-type-docs',
		doc: 'vscode-icons:folder-type-docs',

		// Dependencies
		node_modules: 'vscode-icons:folder-type-node',
		vendor: 'vscode-icons:folder-type-vendor',
		packages: 'vscode-icons:folder-type-package',

		// Version control
		'.git': 'vscode-icons:folder-type-git',
		'.svn': 'vscode-icons:folder-type-svn',

		// IDE
		'.vscode': 'vscode-icons:folder-type-vscode',
		'.idea': 'vscode-icons:folder-type-idea',

		// Other
		logs: 'vscode-icons:folder-type-log',
		temp: 'vscode-icons:folder-type-temp',
		tmp: 'vscode-icons:folder-type-temp',
		cache: 'vscode-icons:folder-type-temp',
		backup: 'vscode-icons:folder-type-backup',
		backups: 'vscode-icons:folder-type-backup',
		locale: 'vscode-icons:folder-type-locale',
		i18n: 'vscode-icons:folder-type-locale',
		translations: 'vscode-icons:folder-type-locale',

		// Default
		default: 'vscode-icons:default-folder'
	};

	// Get the appropriate icon
	function getIcon() {
		if (isDirectory) {
			const folderName = (path.split('/').pop() ?? '').toLowerCase();
			return directoryIcons[folderName] || directoryIcons.default;
		}

		// Check for special file names first
		const fileName = (path.split('/').pop() ?? '').toLowerCase();
		if (fileNameIcons[fileName]) {
			return fileNameIcons[fileName];
		}

		// Then check by extension
		const ext = getExtension(path);
		return extensionIcons[ext] || extensionIcons.default;
	}
</script>

<Icon icon={getIcon()} class={className} />
