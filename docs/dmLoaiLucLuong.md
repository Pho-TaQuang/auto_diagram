classDiagram
class DmLoaiLucLuongController {
  <<Controller>>
  -_manager IDmLoaiLucLuongManager
  +Paging(PageModel pageModel) Task~ApiResponse~
  +InsertOrUpdate(DmLoaiLucLuongModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +SelectOne(string Id) Task~ApiResponse~
}

class IDmLoaiLucLuongManager {
  <<ManagerInterface>>
  +Paging(PageModel model) Task~ApiResponse~
  +InsertOrUpdate(DmLoaiLucLuongModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +SelectOne(string Id) Task~ApiResponse~
}

class DmLoaiLucLuongManager {
  <<Manager>>
  -_currentContext ICurrentContext
  -_autoMap AutoMap
  +Paging(PageModel model) Task~ApiResponse~
  +InsertOrUpdate(DmLoaiLucLuongModel model) Task~ApiResponse~
  +Delete(string id) Task~ApiResponse~
  +SelectOne(string Id) Task~ApiResponse~
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
  +IconId String
  +Id String
  +MaLoai String
  +MoTa String
  +NgaySua DateTime
  +NgayTao DateTime
  +NguoiSua String
  +NguoiTao String
  +TenLoai String
  +TrangThai String
  +Unitcode String
}

class DmLoaiLucLuongModel {
  <<Model>>
  +Id string
  +MaLoai string
  +TenLoai string
  +MoTa string
  +TrangThai string
  +Unitcode string
  +NgayTao DateTime
  +NguoiTao string
  +NgaySua DateTime
  +NguoiSua string
  +IconId string
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

DmLoaiLucLuongController ..> IDmLoaiLucLuongManager : inject/call
IDmLoaiLucLuongManager <|.. DmLoaiLucLuongManager : implements
DmLoaiLucLuongManager ..> DataAccessAdapterFactory : creates adapter
DataAccessAdapterFactory ..> DataAccessAdapter : creates
DmLoaiLucLuongManager ..> SysdmLoaiLucLuongEntity : CRUD/map
DmLoaiLucLuongManager ..> DmLoaiLucLuongModel : map/use
DmLoaiLucLuongManager ..> PageModel : filters/paging
DmLoaiLucLuongController ..> DmLoaiLucLuongModel : input/output
DmLoaiLucLuongController ..> PageModel : input/output