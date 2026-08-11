# SaveAI Viewer

Công cụ web tĩnh (Static Web Tool) giúp tải, hiển thị và xem lịch sử các cuộc hội thoại AI được xuất ra từ Chrome Extension **SaveAI**.

👉 **Demo Trực Tuyến**: [https://trungnguyenthien.github.io/html-render-saveAi/](https://trungnguyenthien.github.io/html-render-saveAi/)

## Tính năng chính
- **Tải file nhanh**: Kéo và thả hoặc chọn tệp tin JSON xuất từ SaveAI để tải cuộc hội thoại ngay lập tức.
- **Thiết kế hiện đại**: Giao diện lấy cảm hứng từ Material Design (M3) cao cấp, hỗ trợ responsive hoàn hảo trên di động.
- **Hiển thị tối ưu**:
  - Tự động nhóm các tin nhắn theo từng phiên cuộc hội thoại (chat session) tương ứng.
  - Hỗ trợ nút **Thu gọn / Mở rộng hội thoại** đặt tại cả **đầu** (Header) và **cuối** (Footer) của cuộc trò chuyện giúp dễ dàng ẩn/hiện toàn bộ luồng tin nhắn dài.
  - Tin nhắn dài của User tự động thu gọn (Xem thêm / Ẩn bớt).
  - Tin nhắn Assistant mặc định thu gọn và chỉ render Markdown + Tô sáng mã nguồn (Syntax Highlighting) khi được mở ra (Lazy Render) giúp cải thiện hiệu năng.
  - Hỗ trợ nút sao chép mã nguồn nhanh (Copy Code).
- **Phát âm tiếng Anh**: Chạm vào các cụm từ tiếng Anh được bọc trong thẻ `[EN]...[/EN]` (in đậm, gạch chân nét đứt) để nghe phát âm giọng nam trầm ấm, tự nhiên (như `Nathan`, `Evan` hoặc `Siri` trên macOS).
- **Định dạng tiếng Việt**: Các thẻ `[VN]...[/VN]` tự động chuyển thành chữ in nghiêng hiển thị rõ ràng.
- **Lưu trữ cục bộ**: Tự động lưu các file đã tải vào `localStorage` của trình duyệt. Trang **Đã lưu** (`#/saved`) hiển thị danh sách lịch sử, thời gian mở cuối cùng, số tin nhắn và cho phép mở lại hoặc xóa.
- **Điều hướng mượt mà**: Sử dụng **View Transitions API** để tạo hiệu ứng chuyển trang (slide-in) native khi chuyển đổi giữa bộ xem và trang lịch sử.

## Hướng dẫn sử dụng
1. Mở file [index.html](index.html) trực tiếp trên trình duyệt, hoặc chạy máy chủ cục bộ:
   ```bash
   npx http-server -p 8080
   ```
2. Tải file cuộc hội thoại mẫu [sample.json](sample.json) hoặc [speech_sample.json](speech_sample.json) để trải nghiệm toàn bộ tính năng.
