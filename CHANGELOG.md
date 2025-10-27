# [1.16.0](https://github.com/obviyus/playtime-panorama/compare/v1.15.0...v1.16.0) (2025-10-27)


### Features

* rate limit outbound Steam API calls ([cb39263](https://github.com/obviyus/playtime-panorama/commit/cb39263ef334345f99d4fa0c50057ec5f0a6fce6))

# [1.15.0](https://github.com/obviyus/playtime-panorama/compare/v1.14.0...v1.15.0) (2025-10-27)


### Features

* remove Deck APIs and buttons ([df7ee89](https://github.com/obviyus/playtime-panorama/commit/df7ee8904ad15b6d4737b4913308f27a26d0e4c7))

# [1.14.0](https://github.com/obviyus/playtime-panorama/compare/v1.13.0...v1.14.0) (2025-10-27)


### Features

* manual refresh button ([5b007d6](https://github.com/obviyus/playtime-panorama/commit/5b007d6f24cf7a14333f685ee01e69a30ef76b3f))

# [1.13.0](https://github.com/obviyus/playtime-panorama/compare/v1.12.0...v1.13.0) (2025-10-27)


### Features

* round-robin API keys to avoid hitting rate limits ([6a6412b](https://github.com/obviyus/playtime-panorama/commit/6a6412bab278718fba13ae7547e4b0965e62dbc5))

# [1.12.0](https://github.com/obviyus/playtime-panorama/compare/v1.11.0...v1.12.0) (2025-10-27)


### Features

* materialized views for leaderboard ([26e3215](https://github.com/obviyus/playtime-panorama/commit/26e32158969239b1b054d35fbe2effce1c70009b))

# [1.11.0](https://github.com/obviyus/playtime-panorama/compare/v1.10.0...v1.11.0) (2025-10-27)


### Bug Fixes

* remove backfill API ([ec3f6d0](https://github.com/obviyus/playtime-panorama/commit/ec3f6d0e7f690ef87f4c9832a3325dc4a66a2bd4))


### Features

* add button for Steam Deck playtime ([00336a8](https://github.com/obviyus/playtime-panorama/commit/00336a84c24002538b43942a439a7eceba2d55bf))
* profile mosaic specific to steam deck playtime ([63cb960](https://github.com/obviyus/playtime-panorama/commit/63cb9602de218261ac604aa375b7373892284dce))

# [1.10.0](https://github.com/obviyus/playtime-panorama/compare/v1.9.0...v1.10.0) (2025-10-27)


### Features

* API to backfill missing OS data ([4621f73](https://github.com/obviyus/playtime-panorama/commit/4621f738a621322a0e703d6d27782c69358fa9b1))
* improved error message page ([ac2e06f](https://github.com/obviyus/playtime-panorama/commit/ac2e06f5986f179617d10ff796219a3ad7476bb3))

# [1.9.0](https://github.com/obviyus/playtime-panorama/compare/v1.8.0...v1.9.0) (2025-10-27)


### Features

* store playtime by os ([790c183](https://github.com/obviyus/playtime-panorama/commit/790c18353411925d27bd6d1a8d2a5d860e21b766))

# [1.8.0](https://github.com/obviyus/playtime-panorama/compare/v1.7.0...v1.8.0) (2025-10-27)


### Features

* improved leaderboard stats ([e78bae1](https://github.com/obviyus/playtime-panorama/commit/e78bae1be1946c411ba40233f9012f951533bb0d))

# [1.7.0](https://github.com/obviyus/playtime-panorama/compare/v1.6.0...v1.7.0) (2025-10-26)


### Features

* improved attribution and wording ([48589b6](https://github.com/obviyus/playtime-panorama/commit/48589b673e9b42d3cc3fa7adc25fcfbd4ef8947b))

# [1.6.0](https://github.com/obviyus/playtime-panorama/compare/v1.5.0...v1.6.0) (2025-10-26)


### Features

* separate out leaderboard template and API ([869db76](https://github.com/obviyus/playtime-panorama/commit/869db769a965ea7775d137fe3d9d2acfcdeae4c5))

# [1.5.0](https://github.com/obviyus/playtime-panorama/compare/v1.4.0...v1.5.0) (2025-10-26)


### Features

* cache leaderboard responses ([7518f0c](https://github.com/obviyus/playtime-panorama/commit/7518f0cfb9d173da92b693c61ae00acc1c4a0375))

# [1.4.0](https://github.com/obviyus/playtime-panorama/compare/v1.3.1...v1.4.0) (2025-10-26)


### Features

* playtime leaderboard from cache ([02d172d](https://github.com/obviyus/playtime-panorama/commit/02d172d9b428f7b593b786ac54a18d5161c5470e))

## [1.3.1](https://github.com/obviyus/playtime-panorama/compare/v1.3.0...v1.3.1) (2025-10-25)


### Bug Fixes

* only cache "good" responses ([7c301df](https://github.com/obviyus/playtime-panorama/commit/7c301df4caa62e24e555019491996ec6172ba119))

# [1.3.0](https://github.com/obviyus/playtime-panorama/compare/v1.2.3...v1.3.0) (2025-10-25)


### Features

* improved error messages or validation ([75fae38](https://github.com/obviyus/playtime-panorama/commit/75fae38657dd9f47d2a4c8092d89b6057bdc2682))

## [1.2.3](https://github.com/obviyus/playtime-panorama/compare/v1.2.2...v1.2.3) (2025-10-25)


### Bug Fixes

* don't delete expired cache rows ([0d078d9](https://github.com/obviyus/playtime-panorama/commit/0d078d953a9a9546ccff26fd012686aec0fd00f5))
* warn when profile not found ([7c8e90d](https://github.com/obviyus/playtime-panorama/commit/7c8e90dffef03d11cc1318171d900572bb61f5a5))

## [1.2.2](https://github.com/obviyus/playtime-panorama/compare/v1.2.1...v1.2.2) (2025-10-25)


### Bug Fixes

* handle asset failures gracefully ([27d3691](https://github.com/obviyus/playtime-panorama/commit/27d3691e5632bbb01f3cbac152034e3a9d51b640))

## [1.2.1](https://github.com/obviyus/playtime-panorama/compare/v1.2.0...v1.2.1) (2025-10-25)


### Bug Fixes

* re-use downloaded assets ([1449cba](https://github.com/obviyus/playtime-panorama/commit/1449cbaa63200573e2e2641b43327dbc60d0725c))

# [1.2.0](https://github.com/obviyus/playtime-panorama/compare/v1.1.0...v1.2.0) (2025-10-25)


### Features

* download button for mosaic ([dedf054](https://github.com/obviyus/playtime-panorama/commit/dedf054a44d4ca795e46387fb8c7e6bafe74a0b0))

# [1.1.0](https://github.com/obviyus/playtime-panorama/compare/v1.0.2...v1.1.0) (2025-10-25)


### Features

* meta tags for preview ([c829bbf](https://github.com/obviyus/playtime-panorama/commit/c829bbfbae0898d3c56d43eaf9e6f62bdc2fff2f))

## [1.0.2](https://github.com/obviyus/playtime-panorama/compare/v1.0.1...v1.0.2) (2025-10-25)


### Bug Fixes

* safe artifact naming ([bd50fb8](https://github.com/obviyus/playtime-panorama/commit/bd50fb8a5362c42072cb809a0873f61ebceb04d3))

## [1.0.1](https://github.com/obviyus/playtime-panorama/compare/v1.0.0...v1.0.1) (2025-10-25)


### Bug Fixes

* copy over templates and tsconfig for build ([cd95b40](https://github.com/obviyus/playtime-panorama/commit/cd95b404db64ef23214528151cc93b3c47e967e0))

# 1.0.0 (2025-10-25)


### Bug Fixes

* anchor hover scale to avoid image lifting off of bottom edge ([3b10304](https://github.com/obviyus/playtime-panorama/commit/3b103048c580be6b952cfd50d67819b6920938d5))
* better playtime scaling ([9defc3f](https://github.com/obviyus/playtime-panorama/commit/9defc3f3da6f1063ba62c2f272aa7ef23aab09ea))
* Bun HTTP best practices ([0199575](https://github.com/obviyus/playtime-panorama/commit/0199575b8f1f19f3cd06da0d79880933629aa7cc))
* filter out games with < 10 minutes playtime ([608683c](https://github.com/obviyus/playtime-panorama/commit/608683c2db757c3846103d9b7357002ca080518f))
* improved proportional scaling of images ([521baad](https://github.com/obviyus/playtime-panorama/commit/521baad9efa5f34b7916347b1ede8ee58b6b6f3d))
* rename branch for release ([9a09681](https://github.com/obviyus/playtime-panorama/commit/9a096812d151e20899b69ec6f2b5ae1aff07e0c5))
* rename to playtime panorama ([bcf838a](https://github.com/obviyus/playtime-panorama/commit/bcf838a1a83ba2398b1ffbcd1bc5e9facbea0f1a))
* simplified colour scheme ([b77c2a5](https://github.com/obviyus/playtime-panorama/commit/b77c2a5bc50bb853cd2e93ae71cbb3be360e5338))
* use node 24 for release ([caa7982](https://github.com/obviyus/playtime-panorama/commit/caa798288d4cd2cf80504850ec064cf1da70536f))


### Features

* allow user to use vanity URL / username ([1e2910c](https://github.com/obviyus/playtime-panorama/commit/1e2910cc2180886004e29983a481e0701b95422c))
* attempt to fit on screen ([743eafc](https://github.com/obviyus/playtime-panorama/commit/743eafcf4d9d42ca88550cae6c62d983de3512ff))
* author attribution ([335a74d](https://github.com/obviyus/playtime-panorama/commit/335a74dbe1f1a4270ae67d8df5514f3cedf4554a))
* cache using SQLite ([75c30d8](https://github.com/obviyus/playtime-panorama/commit/75c30d8f30dcb20f5ea43c046e199b0031a254ea))
* denser packing of collage images ([40c2606](https://github.com/obviyus/playtime-panorama/commit/40c2606842a9d9e1bf73bf656cd4d6bc3dcf4a48))
* hover effect to show playtime ([4bd9d04](https://github.com/obviyus/playtime-panorama/commit/4bd9d04624283f017bc337b8893f940bd087c82b))
* preconnect Steam CDN to reduce RTT ([618be47](https://github.com/obviyus/playtime-panorama/commit/618be47a97d13080b7e3c4ec346690b5af58bd98))
* remove dotenv dependency ([1b2c79d](https://github.com/obviyus/playtime-panorama/commit/1b2c79ded7815ebd3b8af7ddfb5cca52ebbdb58e))
* scale images to user's game count ([9ad3f38](https://github.com/obviyus/playtime-panorama/commit/9ad3f38d8844995ce7986f3e91bc5caa1abcbd7b))
