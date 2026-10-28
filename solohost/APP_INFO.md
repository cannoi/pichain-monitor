# PiChain Monitor

Suggested app name: PiChain Monitor
Suggested description: PiChain Monitor: tạo cho tôi app:  PiChain Monitor  ứng dụng theo dõi blockchain Pi Network: trạng thái mạng, block mới, giao dịch, ví, số dư, phí và hoạt độ…

Docker image:
paf-app:pichain-monitor

Do not install until this image address exists on GHCR.


PiChain Monitor version is sourced from `package.json` (current package version: 2.3.0). Mount `/app/data` persistently. For custom private Pi Node endpoints, explicitly set `HORIZON_ALLOW_PRIVATE=1` only after verifying the destination.
