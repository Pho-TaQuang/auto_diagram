classDiagram
class NhomBienMoiTruong {
  +maNhom string
  +tenNhom string
  +moTa string
  +phanLoai string
  +trangThai string
  +taoMoi() void
  +capNhatThongTin() void
  +xoa() void
  +xemLichSu() void
}
class BienMoiTruong {
  +maBien string
  +tenBien string
  +kieuGiaTri string
  +giaTriDuocMaHoa boolean
  +trangThai string
  +taoMoi() void
  +capNhatGiaTri() void
  +thietLapMaHoa() void
  +dongBoAirflow() void
}
class LichSuNhomBien {
  +maLichSu string
  +hanhDong string
  +noiDungThayDoi string
  +nguoiThucHien string
  +thoiGianThucHien datetime
  +xemChiTiet() void
  +xuatLichSu() void
  +xoaLichSu() void
}
class LichSuBienMoiTruong {
  +maLichSu string
  +hanhDong string
  +giaTriTruoc string
  +giaTriSau string
  +lyDoThayDoi string
  +xemChiTiet() void
  +xuatLichSu() void
  +xoaLichSu() void
}
class MoiTruongThucThi {
  +maMoiTruong string
  +tenMoiTruong string
  +loaiMoiTruong string
  +trangThai string
  +moTa string
  +taoMoi() void
  +ganNhomBien() void
  +capNhatThongTin() void
  +kichHoat() void
  +huyKichHoat() void
}
class GanNhomBienMoiTruong {
  +maGan string
  +phamViApDung string
  +thuTuUuTien int
  +trangThai string
  +ngayGan datetime
  +ganNhom() void
  +goGanNhom() void
  +doiUuTien() void
}
class GiaTriBienDaGiai {
  +maGiaTri string
  +tenBien string
  +giaTriHienThi string
  +nguonGiaTri string
  +thoiDiemGiai datetime
  +xemGiaTri() void
  +kiemTraHopLe() void
}
class DichVuSuDungMoiTruong {
  +maDichVu string
  +tenDichVu string
  +loaiDichVu string
  +trangThaiKetNoi string
  +lanKiemTraCuoi datetime
  +xemDanhSach() void
  +kiemTraKetNoi() void
}
class KiemTraKhoDoiTuong {
  +maKiemTra string
  +tenKho string
  +duongDan string
  +ketQua string
  +thoiDiemKiemTra datetime
  +kiemTraTonTai() void
  +ghiNhanKetQua() void
}

NhomBienMoiTruong "1" *-- "0..*" BienMoiTruong : gồm biến
NhomBienMoiTruong "1" *-- "0..*" LichSuNhomBien : ghi lịch sử
BienMoiTruong "1" *-- "0..*" LichSuBienMoiTruong : ghi lịch sử
MoiTruongThucThi "1" *-- "0..*" GanNhomBienMoiTruong : gán nhóm
GanNhomBienMoiTruong "0..*" --> "1" NhomBienMoiTruong : tham chiếu nhóm
MoiTruongThucThi "1" o-- "0..*" DichVuSuDungMoiTruong : được dịch vụ dùng
MoiTruongThucThi "1" *-- "0..*" GiaTriBienDaGiai : giải biến
GiaTriBienDaGiai "0..*" --> "1" BienMoiTruong : lấy từ biến
MoiTruongThucThi "1" *-- "0..*" KiemTraKhoDoiTuong : kiểm tra kho