# Hướng dẫn cài đặt trên Pi SoloHost

1. Đảm bảo bạn đã cài đặt Pi SoloHost.
2. Tải hoặc cấu hình gói dịch vụ với `docker-compose.yml` và `config_options.yml`.
3. Khởi chạy bằng lệnh SoloHost hoặc Docker Compose.
4. Truy cập giao diện trực tiếp qua cổng được cấu hình.


PiChain Monitor version is sourced from `package.json` (current package version: 2.3.0). Mount `/app/data` persistently. For custom private Pi Node endpoints, explicitly set `HORIZON_ALLOW_PRIVATE=1` only after verifying the destination.
