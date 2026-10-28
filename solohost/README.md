# PiChain Monitor (SoloHost)

Version: see root package.json (2.2.x).

Mount `./data` for SQLite persistence. Set env from config_options.yml.

# PiChain Monitor — SoloHost install kit

Use the two install files:
- docker-compose.yml
- config_options.yml

Suggested name: PiChain Monitor
Suggested description: tạo cho tôi app:  PiChain Monitor  ứng dụng theo dõi blockchain Pi Network: trạng thái mạng, block mới, giao dịch, ví, số dư, phí và hoạt động mạng theo thời gian thực. Giao diện đơn giản, nhanh, dễ sử dụng và tối ưu cho Pi Browser/SoloHost.2. Local Domain Host đa nền tảng

Image:
paf-app:pichain-monitor

If something fails, paste the SoloHost error back into App Builder. It will use the saved project context to diagnose and repair the release.


PiChain Monitor version is sourced from `package.json` (current package version: 2.3.0). Mount `/app/data` persistently. For custom private Pi Node endpoints, explicitly set `HORIZON_ALLOW_PRIVATE=1` only after verifying the destination.
