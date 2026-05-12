classDiagram
class QuanLySuKienController {
  <<Controller>>
  -_manager IQuanLySuKienManager
  +Paging(SuKienSearchModel model) Task~ApiResponse~
  +PagingTheoDonViThamGia(SuKienSearchModel model) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +SelectOneCustom(string id) Task~ApiResponse~
  +InsertOrUpdate(SuKienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +ChangeTinhTrang(ChangeTinhTrangSuKienModel model) Task~ApiResponse~
  +ChangeMucDoRuiRo(ChangeMucDoRuiRoModel model) Task~ApiResponse~
  +ExportKeHoachSuKien(ExportKeHoachSuKienModel model, ExportFileModel exportModel) Task~ApiResponse~
  +GetTinhTrangOptions() Task~ApiResponse~
  +GetDanhSachSoDo(string suKienId) Task~ApiResponse~
  +GetSoDoById(string id) Task~ApiResponse~
  +InsertOrUpdateSoDo(SuKienSoDoModel model) Task~ApiResponse~
  +DeleteSoDo(string id) Task~ApiResponse~
}

class IQuanLySuKienManager {
  <<ManagerInterface>>
  +Paging(SuKienSearchModel model) Task~ApiResponse~
  +PagingTheoDonViThamGia(SuKienSearchModel model) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +SelectOneCustom(string id) Task~ApiResponse~
  +InsertOrUpdate(SuKienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +ChangeTinhTrang(ChangeTinhTrangSuKienModel model) Task~ApiResponse~
  +ChangeMucDoRuiRo(ChangeMucDoRuiRoModel model) Task~ApiResponse~
  +ExportKeHoachSuKien(ExportKeHoachSuKienModel model, ExportFileModel exportModel) Task~ApiResponse~
  +GetTinhTrangOptions() Task~ApiResponse~
  +GetDanhSachSoDo(string suKienId) Task~ApiResponse~
  +GetSoDoById(string id) Task~ApiResponse~
  +InsertOrUpdateSoDo(SuKienSoDoModel model) Task~ApiResponse~
  +DeleteSoDo(string id) Task~ApiResponse~
}

class QuanLySuKienManager {
  <<Manager>>
  -_currentContext ICurrentContext
  -_autoMap AutoMap
  -sysUnitManager ISysUnitManager
  +Paging(SuKienSearchModel model) Task~ApiResponse~
  +PagingTheoDonViThamGia(SuKienSearchModel model) Task~ApiResponse~
  +SelectOneCustom(string id) Task~ApiResponse~
  +SelectOne(string id) Task~ApiResponse~
  +InsertOrUpdate(SuKienModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +ChangeTinhTrang(ChangeTinhTrangSuKienModel model) Task~ApiResponse~
  +ChangeMucDoRuiRo(ChangeMucDoRuiRoModel model) Task~ApiResponse~
  +ExportKeHoachSuKien(ExportKeHoachSuKienModel model, ExportFileModel exportModel) Task~ApiResponse~
  +GetTinhTrangOptions() Task~ApiResponse~
  +GetDanhSachSoDo(string suKienId) Task~ApiResponse~
  +GetSoDoById(string id) Task~ApiResponse~
  +InsertOrUpdateSoDo(SuKienSoDoModel model) Task~ApiResponse~
  +DeleteSoDo(string id) Task~ApiResponse~
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

class SysdmTinhTrangSuKienEntity {
  <<LLBLGenEntity>>
  +Id String
  +MaTinhTrang String
  +TenTinhTrang String
  +ThuTuHienThi Int32
}

class SysfilemanagerEntity {
  <<LLBLGenEntity>>
  +Createddate DateTime
  +Recordid String
}

class SysqlpaKeHoachNhanLucEntity {
  <<LLBLGenEntity>>
  +CapKeHoach String
  +SuKienId String
  +TrangThaiKeHoach String
  +Unitcode String
}

class SysqlskKeHoachDonViEntity {
  <<LLBLGenEntity>>
  +Id String
  +KeHoachCtId String
  +MaDonVi String
  +NgayTao DateTime
  +Unitcode String
}

class SysqlskKeHoachSuKienCtEntity {
  <<LLBLGenEntity>>
  +Id String
  +KeHoachId String
  +Stt Int64
}

class SysqlskKeHoachSuKienEntity {
  <<LLBLGenEntity>>
  +Id String
  +NgayLap DateTime
  +SuKienId String
  +TrangThaiKeHoach String
}

class SysqlskLichSuXuLyEntity {
  <<LLBLGenEntity>>
  +Id String
  +MaSuKien string
  +Mota string
  +MucDoRuiRo string
  +NgaySua string
  +NgayTao string
  +NguoiSua string
  +NguoiTao string
  +Recordid string
  +Tensodo string
  +ThoiGianBatDau string
  +ThoiGianKetThuc string
  +TinhTrangSuKienId string
  +Unitcode String
}

class SysqlskSuKienEntity {
  <<LLBLGenEntity>>
  +DiaDiemChinh String
  +Id String
  +MaSuKien String
  +Mota String
  +MucDoRuiRo String
  +NgaySua DateTime
  +NgayTao DateTime
  +NguoiSua String
  +NguoiTao String
  +Recordid string
  +Tensodo string
  +TenSuKien String
  +ThoiGianBatDau DateTime
  +ThoiGianKetThuc DateTime
  +TinhTrangSuKienId String
  +Unitcode String
}

class SysqlskSuKienSoDoEntity {
  <<LLBLGenEntity>>
  +Id String
  +MaSuKien string
  +Mota String
  +MucDoRuiRo string
  +NgaySua DateTime
  +NgayTao DateTime
  +NguoiSua String
  +NguoiTao String
  +Recordid String
  +Tensodo String
  +ThoiGianBatDau string
  +ThoiGianKetThuc string
  +TinhTrangSuKienId string
  +Unitcode String
}

class ChangeMucDoRuiRoModel {
  <<Model>>
  +SuKienId string
  +MucDoRuiRo string
  +NoiDung string
  +UnitCode string
}

class ChangeTinhTrangSuKienModel {
  <<Model>>
  +SuKienId string
  +TinhTrangSuKienId string
  +NoiDung string
  +UnitCode string
}

class ExportFileModel {
  <<Model>>
  +FileType string
  +FileName string
}

class ExportKeHoachSuKienModel {
  <<Model>>
  +Id string
  +MaSuKien string
  +TenSuKien string
  +LoaiSuKien string
  +ThoiGianBatDau DateTime?
  +ThoiGianKetThuc DateTime?
  +MaTinh string
  +MaXa string
  +DiaDiemChinh string
  +Shape string
  +MucDoRuiRo string
  +TinhTrangSuKienId string
  +CoPhatSinhKeHoach string
  +NguoiLienHe string
  +SoDienThoai string
  +MoTa string
  +ThuTuHienThi int?
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
  +TenTinhTrangSuKien string
  +MaTinhTrangSuKien string
  +DaCoKeHoachNhanLucTheoCap string
  +SuKienId string
  +SoKeHoach string
  +TenKeHoach string
  +PhienBan int?
  +NoiDungKeHoach string
  +TrangThaiKeHoach string
  +LaKeHoachHienHanh string
  +DonViDeXuat string
  +NgayLap DateTime?
  +NguoiDeXuat string
  +NgayTrinhDuyet DateTime?
  +NgayDuyet DateTime?
  +NguoiDuyet string
  +YKienDuyet string
  +LyDoTuChoi string
  +LyDoHuy string
  +GhiChu string
  +NgayTao1 DateTime?
  +NguoiTao1 string
  +NgaySua1 DateTime?
  +NguoiSua1 string
  +UnitCode1 string
  +MaSuKien1 string
  +TenSuKien1 string
  +TenTinhTrangSuKien1 string
  +DanhSachDonVi List~KeHoachDonViModel~
  +ChiCoSuKienCoKeHoachSuKienDaDuyet bool
  +CapLapKeHoachNhanLuc string
  +BoSungCoKeHoachNhanLucTheoCap bool
}

class FileAttachCtModel {
  <<Model>>
  +Id long
  +RecordId string
  +FileName string
  +FilePath string
  +Tensodo string
  +MoTa string
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
}

class KeHoachDonViModel {
  <<Model>>
  +Id string
  +KeHoachCtId string
  +MaDonVi string
  +TenDonVi string
  +LoaiDonViThamGia string
  +VaiTroThamGia string
  +GhiChu string
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
}

class KeHoachSuKienChiTietModel {
  <<Model>>
  +Id string
  +KeHoachId string
  +TenNhiemVu string
  +LoaiNhiemVu string
  +MoTaNhiemVu string
  +ThoiGianBatDau DateTime?
  +ThoiGianKetThuc DateTime?
  +LoaiPhamVi string
  +HeToaDo string
  +Shape string
  +MoTaPhamVi string
  +MauHienThi string
  +TrangThai string
  +HienThi string
  +GhiChu string
  +DiemDau string
  +DiemKetthuc string
  +ViTri string
  +SuKienId string
  +Stt int?
  +ThoigianDichuyen string
  +VanToc string
  +KhoangCach string
  +Uid string
  +DanhSachDonVi List~KeHoachDonViModel~
  +lstDeleteDonVi List~string~
  +DinhKemFiles List~FileAttachCtModel~
  +lstDeleteFile List~string~
}

class KeHoachSuKienModel {
  <<Model>>
  +Id string
  +SuKienId string
  +SoKeHoach string
  +TenKeHoach string
  +PhienBan int?
  +NoiDungKeHoach string
  +TrangThaiKeHoach string
  +LaKeHoachHienHanh string
  +DonViDeXuat string
  +NgayLap DateTime?
  +NguoiDeXuat string
  +NgayTrinhDuyet DateTime?
  +NgayDuyet DateTime?
  +NguoiDuyet string
  +YKienDuyet string
  +LyDoTuChoi string
  +LyDoHuy string
  +GhiChu string
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
  +MaSuKien string
  +TenSuKien string
  +TenTinhTrangSuKien string
  +DanhSachSuKienCT List~KeHoachSuKienChiTietModel~
  +lstDeleteCt List~string~
  +lstDeleteFile List~string~
  +lstDeleteDonVi List~string~
}

class SuKienModel {
  <<Model>>
  +Id string
  +MaSuKien string
  +TenSuKien string
  +LoaiSuKien string
  +ThoiGianBatDau DateTime?
  +ThoiGianKetThuc DateTime?
  +DiaDiemChinh string
  +Shape string
  +MucDoRuiRo string
  +TinhTrangSuKienId string
  +CoPhatSinhKeHoach string
  +NguoiLienHe string
  +SoDienThoai string
  +MoTa string
  +ThuTuHienThi int?
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
  +TenTinhTrangSuKien string
  +MaTinhTrangSuKien string
  +MaTinh string
  +MaXa string
  +DanhSachSoDo List~SuKienSoDoModel~
  +DanhSachKeHoach List~KeHoachSuKienModel~
  +DaCoKeHoachNhanLucTheoCap string
}

class SuKienSearchModel {
  <<DTO>>
  +CurrentPage int
  +PageSize int
  +StrKey string
  +MaSuKien string
  +TenSuKien string
  +LoaiSuKien string
  +DiaBan string
  +MucDoRuiRo string
  +TinhTrangSuKienId string
  +StartDate string
  +EndDate string
  +UnitCode string
  +ChiCoSuKienCoKeHoachSuKienDaDuyet bool
  +CapLapKeHoachNhanLuc string
  +BoSungCoKeHoachNhanLucTheoCap bool
}

class SuKienSoDoModel {
  <<Model>>
  +Id string
  +RecordId string
  +FileName string
  +FilePath string
  +Tensodo string
  +MoTa string
  +NgayTao DateTime?
  +NguoiTao string
  +NgaySua DateTime?
  +NguoiSua string
  +UnitCode string
}

class SysUnitModel {
  <<Model>>
  +Unitcode string
  +Tendonvi string
  +Macha string
  +Trangthai decimal?
  +Tenviettat string
  +Capdonvi decimal?
  +Masothue string
  +Diachi string
  +Linhvuc string
  +Sodienthoai string
  +Type int?
  +Email string
  +Fax string
}

class TinhTrangSuKienModel {
  <<Model>>
  +Id string
  +MaTinhTrang string
  +TenTinhTrang string
}

QuanLySuKienController ..> IQuanLySuKienManager : inject/call
IQuanLySuKienManager <|.. QuanLySuKienManager : implements
QuanLySuKienManager ..> DataAccessAdapterFactory : creates adapter
QuanLySuKienManager ..> SysdmTinhTrangSuKienEntity : query/map options
QuanLySuKienManager ..> SysfilemanagerEntity : query/map attachment
QuanLySuKienManager ..> SysqlpaKeHoachNhanLucEntity : query/check planning status
QuanLySuKienManager ..> SysqlskKeHoachDonViEntity : query/map/export
QuanLySuKienManager ..> SysqlskKeHoachSuKienCtEntity : query/map/export
QuanLySuKienManager ..> SysqlskKeHoachSuKienEntity : query/map/export
QuanLySuKienManager ..> SysqlskLichSuXuLyEntity : save history
QuanLySuKienManager ..> SysqlskSuKienEntity : CRUD/status/map
QuanLySuKienManager ..> SysqlskSuKienSoDoEntity : CRUD/map event diagrams
QuanLySuKienManager ..> ChangeMucDoRuiRoModel : use
QuanLySuKienManager ..> ChangeTinhTrangSuKienModel : use
QuanLySuKienManager ..> ExportFileModel : use
QuanLySuKienManager ..> ExportKeHoachSuKienModel : use
QuanLySuKienManager ..> FileAttachCtModel : use
QuanLySuKienManager ..> KeHoachDonViModel : use
QuanLySuKienManager ..> KeHoachSuKienChiTietModel : use
QuanLySuKienManager ..> KeHoachSuKienModel : use
QuanLySuKienManager ..> SuKienModel : use
QuanLySuKienManager ..> SuKienSearchModel : use
QuanLySuKienManager ..> SuKienSoDoModel : use
QuanLySuKienManager ..> SysUnitModel : use
QuanLySuKienManager ..> TinhTrangSuKienModel : use
DataAccessAdapterFactory ..> DataAccessAdapter : creates
QuanLySuKienController ..> ChangeMucDoRuiRoModel : input/output
QuanLySuKienController ..> ChangeTinhTrangSuKienModel : input/output
QuanLySuKienController ..> ExportFileModel : input/output
QuanLySuKienController ..> ExportKeHoachSuKienModel : input/output
QuanLySuKienController ..> FileAttachCtModel : input/output
QuanLySuKienController ..> KeHoachDonViModel : input/output
QuanLySuKienController ..> KeHoachSuKienChiTietModel : input/output
QuanLySuKienController ..> KeHoachSuKienModel : input/output
QuanLySuKienController ..> SuKienModel : input/output
QuanLySuKienController ..> SuKienSearchModel : input/output
QuanLySuKienController ..> SuKienSoDoModel : input/output
QuanLySuKienController ..> SysUnitModel : input/output
QuanLySuKienController ..> TinhTrangSuKienModel : input/output