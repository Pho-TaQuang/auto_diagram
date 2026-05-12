classDiagram
class DmPhuongTienController {
  <<Controller>>
  -_manager IDmPhuongTienManager
  +Paging(DmPhuongTienPageModel pageModel) Task~ApiResponse~
  +InsertOrUpdate(DmPhuongTienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +UpdateTinhTrang(string id, string tinhtrang) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +GetLoaiLucLuongOptions(string strKey) Task~ApiResponse~
  +UpdateIconByType(string typePhuongTien, string iconId) Task~ApiResponse~
}

class IDmPhuongTienManager {
  <<ManagerInterface>>
  +Paging(DmPhuongTienPageModel model) Task~ApiResponse~
  +InsertOrUpdate(DmPhuongTienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +UpdateTinhTrang(string id, string tinhtrang) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +GetLoaiLucLuongOptions(string strKey) Task~ApiResponse~
  +UpdateIconByType(string typePhuongTien, string iconId) Task~ApiResponse~
}

class DmPhuongTienManager {
  <<Manager>>
  -_currentContext ICurrentContext
  -_autoMap AutoMap
  +Paging(DmPhuongTienPageModel model) Task~ApiResponse~
  +InsertOrUpdate(DmPhuongTienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +UpdateTinhTrang(string id, string tinhtrang) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +GetLoaiLucLuongOptions(string strKey) Task~ApiResponse~
  +AddKeywordPredicate(RelationPredicateBucket filter, string keyword, EntityField2[] fields) void
  +NormalizeKeyword(string input) string
  +UpdateIconByType(string typePhuongTien, string iconId) Task~ApiResponse~
}

class DataAccessAdapterFactory {
  <<AdapterFactory>>
  -_configSetting ConfigSetting
  +DataAccessAdapterFactory()
  -CreateAdapter(connectionString string) DataAccessAdapter
  +CreateAdapter() DataAccessAdapter
}

class DataAccessAdapter {
  <<DataAccessAdapter>>
  +ConnectionStringKeyName string
  +DataAccessAdapter()
  +DataAccessAdapter(keepConnectionOpen bool)
  +DataAccessAdapter(connectionString string)
  +DataAccessAdapter(connectionString string, keepConnectionOpen bool)
}

class SysdmLoaiLucLuongEntity {
  <<LLBLGenEntity>>
  +MaLoai String
  +MoTa String
  +TenLoai String
  +TrangThai String
}

class SysdmPhuongTienEntity {
  <<LLBLGenEntity>>
  +BienSo String
  +CameraAccount String
  +CameraIp String
  +ChieuCao Double
  +ChieuDai Double
  +ChieuRong Double
  +ChungLoai String
  +CoCameraHanhTrinh String
  +CoCoiUuTien String
  +CoDenUuTien String
  +CoGps String
  +CongNang String
  +CongSuatBom Double
  +DiaChi String
  +DinhMucNhienLieu String
  +DonViQuanLy String
  +DungTichBonNuoc Double
  +DungTichNhienLieu Double
  +GhiChuNhanSuDiKem String
  +GpsDeviceId String
  +HanBaoTriTiepTheo DateTime
  +HangXe String
  +IconId String
  +Id String
  +LaiXeMacDinhId String
  +LoaiNhienLieu String
  +MaDinhDanhGps String
  +MaPhuongTien String
  +Matinh String
  +Maxa String
  +Model String
  +MoTa String
  +NamSanXuat Int16
  +NgayBaoTriGanNhat DateTime
  +NgaySua DateTime
  +NgayTao DateTime
  +NguoiSua String
  +Shape String
  +SoCho Int32
  +SoSeri String
  +TenPhuongTien String
  +ThongSoKyThuat String
  +TinhTrangSanSang String
  +ToaDoX Double
  +ToaDoY Double
  +ToLaiXeMacDinh String
  +TrangThai String
  +TrongTai Double
  +TypePhuongTien String
  +Unitcode String
}

class DmPhuongTienModel {
  <<Model>>
  +Id string
  +MaPhuongTien string
  +TenPhuongTien string
  +TypePhuongTien string
  +TrangThai string
  +Unitcode string
  +NgayTao DateTime
  +NguoiTao string
  +NgaySua DateTime
  +NguoiSua string
  +BienSo string
  +ChungLoai string
  +HangXe string
  +Model string
  +NamSanXuat int?
  +SoSeri string
  +SoCho string
  +SoLuong int
  +ThongSoKyThuat string
  +CongNang string
  +CongSuatBom double?
  +DungTichBonNuoc double?
  +DonViTinh string
  +DiaBan string
  +DiaChi string
  +DonViQuanLy string
  +MoTa string
  +TinhTrangSanSang string
  +IconId string
  +Shape string
  +CameraAccount string
  +CameraIp string
  +ChieuCao double?
  +ChieuDai double?
  +ChieuRong double?
  +CoCameraHanhTrinh string
  +CoCoiUuTien string
  +CoDenUuTien string
  +CoGps string
  +DinhMucNhienLieu string
  +DungTichNhienLieu double?
  +GhiChuNhanSuDiKem string
  +GpsDeviceId string
  +HanBaoTriTiepTheo DateTime?
  +LaiXeMacDinhId string
  +LoaiNhienLieu string
  +MaDinhDanhGps string
  +Matinh string
  +Maxa string
  +NgayBaoTriGanNhat DateTime?
  +ToLaiXeMacDinh string
  +TrongTai double?
  +ToaDoX double?
  +ToaDoY double?
  +LoaiLucLuongTen string
  +DonViQuanLyTen string
}

class DmPhuongTienPageModel {
  <<DTO>>
  +Search string
  +TypePhuongTien string
  +MaPhuongTien string
  +TenPhuongTien string
  +BienSo string
  +DonViQuanLy string
  +DiaBan string
  +TinhTrangSuDung string
  +TrangThai string
}

class SysQlpaModel_LoaiLucLuongOptionModel {
  <<Model>>
  +Id string
  +MaLoai string
  +TenLoai string
  +MoTa string
  +UnitCode string
}

class PageModel {
  <<DTO>>
  +Search string
  +CurrentPage int
  +PageSize int
  +Condition string
  +SortColumn string
  +SortExpression string
  +Status string
  +ColumnName string
}

DmPhuongTienController ..> IDmPhuongTienManager : inject/call
IDmPhuongTienManager <|.. DmPhuongTienManager : implements
PageModel <|-- DmPhuongTienPageModel : extends
DmPhuongTienManager ..> DataAccessAdapterFactory : creates adapter
DmPhuongTienManager ..> SysdmLoaiLucLuongEntity : query/map options
DmPhuongTienManager ..> SysdmPhuongTienEntity : CRUD/status/map
DmPhuongTienManager --* DmPhuongTienModel : use
DmPhuongTienManager ..> DmPhuongTienPageModel : use
DmPhuongTienManager ..> SysQlpaModel_LoaiLucLuongOptionModel : use
DataAccessAdapterFactory ..> DataAccessAdapter : creates
DmPhuongTienController ..> DmPhuongTienModel : input/output
DmPhuongTienController ..> DmPhuongTienPageModel : input/output
DmPhuongTienController ..> SysQlpaModel_LoaiLucLuongOptionModel : input/output