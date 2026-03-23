/**
 * ============================================================
 *  명불허전학원 통합 상담 관리 포털 — Backend API
 *  파일: ConsultPortalAPI.gs
 *  접두어: cp_ (consult portal)
 *  
 *  ⚠️ 설치 방법:
 *  1. 이 파일을 기존 Apps Script 프로젝트에 새 .gs 파일로 추가
 *  2. ReportGenerator.gs의 doGet() 맨 앞에 cp_ 분기 코드 삽입
 *  3. doPost()에도 cp_ 분기 코드 삽입
 *  4. [CONFIG] 시트에 CP_ADMIN_PASSWORD 행 추가
 *  5. [MASTER] 상담관리자계정 시트 생성 (선택)
 * ============================================================
 */

// ─── 상수 ───────────────────────────────────────────────────
var CP_VERSION = '1.0.0';
var CP_TOKEN_EXPIRY_HOURS = 24;
var CP_SHEET_CONFIG = '[CONFIG]';
var CP_SHEET_DASHBOARD = '[DASHBOARD] 상담 주기 관리';
var CP_SHEET_CONSULT_LOG = '[DB] 상담로그';
var CP_SHEET_PARENT_LOG = '[DB] 학부모 상담로그';
var CP_SHEET_REPORT_DATA = '[HELPER] 리포트 데이터';
var CP_SHEET_QUEUE = '[대기열]';
var CP_SHEET_DAILY_LOG = '[RAW] 일일로그';

// ─── doGet 분기 핸들러 (ReportGenerator.gs에서 호출) ─────────
function cpHandleGet_(e) {
  var action = (e.parameter.action || '').trim();
  var token = (e.parameter.token || '').trim();
  
  // 로그인은 토큰 불필요
  if (action === 'cp_login') {
    return cpLogin_(e);
  }
  
  // 나머지는 토큰 검증
  if (!cpValidateToken_(token)) {
    return cpJsonResponse_({ success: false, error: '인증이 만료되었습니다. 다시 로그인해주세요.' });
  }
  
  switch (action) {
    case 'cp_dashboard':
      return cpGetDashboard_(e);
    case 'cp_studentList':
      return cpGetStudentList_(e);
    case 'cp_consultHistory':
      return cpGetConsultHistory_(e);
    case 'cp_parentConsultHistory':
      return cpGetParentConsultHistory_(e);
    case 'cp_queueStatus':
      return cpGetQueueStatus_(e);
    case 'cp_reportList':
      return cpGetReportList_(e);
    case 'cp_biweeklyList':
      return cpGetBiweeklyList_(e);
    case 'cp_briefingData':
      return cpGetBriefingData_(e);
    case 'cp_version':
      return cpJsonResponse_({ success: true, version: CP_VERSION });
    default:
      return cpJsonResponse_({ success: false, error: '알 수 없는 요청: ' + action });
  }
}

// ─── doPost 분기 핸들러 ──────────────────────────────────────
function cpHandlePost_(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return cpJsonResponse_({ success: false, error: 'JSON 파싱 오류' });
  }
  
  var action = (body.action || '').trim();
  var token = (body.token || '').trim();
  
  // 로그인은 토큰 불필요
  if (action === 'cp_login') {
    return cpLoginPost_(body);
  }
  
  if (!cpValidateToken_(token)) {
    return cpJsonResponse_({ success: false, error: '인증이 만료되었습니다.' });
  }
  
  switch (action) {
    case 'cp_saveParentConsult':
      return cpSaveParentConsult_(body);
    case 'cp_saveSession':
      return cpSaveSession_(body);
    case 'cp_resetQueue':
      return cpResetQueue_(body);
    case 'cp_forceProcess':
      return cpForceProcess_(body);
    case 'cp_generateReport':
      return cpGenerateReport_(body);
    case 'cp_fillShortCodes':
      return cpFillShortCodes_(body);
    default:
      return cpJsonResponse_({ success: false, error: '알 수 없는 POST 요청: ' + action });
  }
}

// ─── 인증 ────────────────────────────────────────────────────

/**
 * 로그인 (GET 방식 - 호환용)
 */
function cpLogin_(e) {
  var user = (e.parameter.user || '').trim();
  var pass = (e.parameter.pass || '').trim();
  return cpProcessLogin_(user, pass);
}

/**
 * 로그인 (POST 방식 - 권장)
 */
function cpLoginPost_(body) {
  var user = (body.user || '').trim();
  var pass = (body.pass || '').trim();
  return cpProcessLogin_(user, pass);
}

/**
 * 로그인 공통 처리
 */
function cpProcessLogin_(user, pass) {
  if (!user || !pass) {
    return cpJsonResponse_({ success: false, error: '이름과 비밀번호를 입력해주세요.' });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configSheet = ss.getSheetByName(CP_SHEET_CONFIG);
  
  if (!configSheet) {
    return cpJsonResponse_({ success: false, error: 'CONFIG 시트를 찾을 수 없습니다.' });
  }
  
  // [CONFIG]에서 CP_ACCOUNTS 찾기 (JSON 형식: [{name, password, role}])
  var configData = configSheet.getDataRange().getValues();
  var accounts = null;
  
  for (var i = 0; i < configData.length; i++) {
    if (configData[i][0] === 'CP_ACCOUNTS') {
      try {
        accounts = JSON.parse(configData[i][1]);
      } catch (err) {
        // 단일 비밀번호 방식 폴백
      }
      break;
    }
  }
  
  // 방법 1: CP_ACCOUNTS JSON 배열이 있는 경우
  if (accounts && Array.isArray(accounts)) {
    for (var j = 0; j < accounts.length; j++) {
      if (accounts[j].name === user && accounts[j].password === pass) {
        var token = cpGenerateToken_(user, accounts[j].role || 'counselor');
        return cpJsonResponse_({
          success: true,
          token: token,
          user: user,
          role: accounts[j].role || 'counselor'
        });
      }
    }
    return cpJsonResponse_({ success: false, error: '이름 또는 비밀번호가 일치하지 않습니다.' });
  }
  
  // 방법 2: CP_ADMIN_PASSWORD 단일 비밀번호 (간단 모드)
  var adminPass = null;
  for (var k = 0; k < configData.length; k++) {
    if (configData[k][0] === 'CP_ADMIN_PASSWORD') {
      adminPass = String(configData[k][1]).trim();
      break;
    }
  }
  
  if (adminPass && pass === adminPass) {
    var token2 = cpGenerateToken_(user, 'admin');
    return cpJsonResponse_({
      success: true,
      token: token2,
      user: user,
      role: 'admin'
    });
  }
  
  return cpJsonResponse_({ success: false, error: '이름 또는 비밀번호가 일치하지 않습니다.' });
}

/**
 * 토큰 생성
 */
function cpGenerateToken_(user, role) {
  var token = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  var tokenData = {
    user: user,
    role: role,
    created: new Date().getTime()
  };
  props.setProperty('cp_token_' + token, JSON.stringify(tokenData));
  return token;
}

/**
 * 토큰 검증
 */
function cpValidateToken_(token) {
  if (!token) return false;
  
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('cp_token_' + token);
  if (!raw) return false;
  
  try {
    var data = JSON.parse(raw);
    var elapsed = (new Date().getTime() - data.created) / (1000 * 60 * 60);
    if (elapsed > CP_TOKEN_EXPIRY_HOURS) {
      props.deleteProperty('cp_token_' + token);
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 토큰에서 사용자 정보 추출
 */
function cpGetTokenUser_(token) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('cp_token_' + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ─── 대시보드 API ────────────────────────────────────────────

/**
 * 상담 주기 대시보드 데이터 조회
 * [DASHBOARD] 상담 주기 관리 시트의 전체 데이터를 반환
 */
function cpGetDashboard_(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_DASHBOARD);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '대시보드 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return cpJsonResponse_({ success: true, students: [] });
  }
  
  var headers = data[0];
  var students = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0] || String(row[0]).trim() === '') continue; // 빈 행 무시
    
    var student = {};
    for (var j = 0; j < headers.length; j++) {
      var key = String(headers[j]).trim();
      var val = row[j];
      
      // 날짜 객체 → 문자열 변환
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      student[key] = val;
    }
    student._rowIndex = i + 1; // 시트 행 번호 (1-based)
    students.push(student);
  }
  
  return cpJsonResponse_({ success: true, students: students, headers: headers });
}

/**
 * 학생 목록 (간략 - 이름 + 상태만)
 */
function cpGetStudentList_(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_DASHBOARD);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var list = [];
  
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    if (name) {
      list.push({ name: name, row: i + 1 });
    }
  }
  
  return cpJsonResponse_({ success: true, students: list });
}

// ─── 상담 이력 API ───────────────────────────────────────────

/**
 * 2주 학생 상담 이력 조회
 */
function cpGetConsultHistory_(e) {
  var studentName = (e.parameter.student || '').trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_CONSULT_LOG);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '상담로그 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var records = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // B열 = 학생명 (인덱스 1)
    if (studentName && String(row[1]).trim() !== studentName) continue;
    
    var rec = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      }
      rec[String(headers[j]).trim()] = val;
    }
    records.push(rec);
  }
  
  // 최신순 정렬
  records.reverse();
  
  return cpJsonResponse_({ success: true, records: records });
}

/**
 * 학부모 상담 이력 조회
 */
function cpGetParentConsultHistory_(e) {
  var studentName = (e.parameter.student || '').trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_PARENT_LOG);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '학부모 상담로그 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var records = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (studentName && String(row[0]).trim() !== studentName) continue;
    
    var rec = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      rec[String(headers[j]).trim()] = val;
    }
    records.push(rec);
  }
  
  records.reverse();
  
  return cpJsonResponse_({ success: true, records: records });
}

// ─── 대기열 API ──────────────────────────────────────────────

/**
 * 대기열 상태 조회
 */
function cpGetQueueStatus_(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_QUEUE);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '대기열 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var items = [];
  var stats = { waiting: 0, processing: 0, done: 0, error: 0 };
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) continue;
    
    var item = {};
    for (var j = 0; j < Math.min(headers.length, row.length); j++) {
      var val = row[j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      }
      item[String(headers[j]).trim()] = val;
    }
    item._rowIndex = i + 1;
    
    // 상태 집계 (H열 = 상태)
    var status = String(row[7] || '').trim().toLowerCase();
    if (status === '대기중' || status === 'waiting') stats.waiting++;
    else if (status === '처리중' || status === 'processing') stats.processing++;
    else if (status === '완료' || status === 'done') stats.done++;
    else if (status === '에러' || status === 'error') stats.error++;
    
    items.push(item);
  }
  
  items.reverse();
  
  return cpJsonResponse_({ success: true, items: items, stats: stats });
}

/**
 * 대기열 멈춤 해제 (POST)
 */
function cpResetQueue_(body) {
  try {
    if (typeof resetStuckQueue === 'function') {
      resetStuckQueue();
    } else {
      // 직접 구현
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(CP_SHEET_QUEUE);
      var data = sheet.getDataRange().getValues();
      var count = 0;
      
      for (var i = 1; i < data.length; i++) {
        var status = String(data[i][7] || '').trim();
        if (status === '처리중') {
          sheet.getRange(i + 1, 8).setValue('대기중');
          count++;
        }
      }
    }
    return cpJsonResponse_({ success: true, message: '멈춤 해제 완료' });
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

/**
 * 대기열 강제 일괄 처리 (POST)
 */
function cpForceProcess_(body) {
  try {
    if (typeof forceProcessQueue === 'function') {
      forceProcessQueue();
    }
    return cpJsonResponse_({ success: true, message: '강제 처리 시작됨' });
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

// ─── 리포트 API ──────────────────────────────────────────────

/**
 * 학부모 리포트 목록
 */
function cpGetReportList_(e) {
  var studentName = (e.parameter.student || '').trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_REPORT_DATA);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '리포트 데이터 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var reports = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (studentName && String(row[0]).trim() !== studentName) continue;
    
    var genDate = row[1];
    if (genDate instanceof Date) {
      genDate = Utilities.formatDate(genDate, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    }
    
    reports.push({
      student: String(row[0]).trim(),
      generatedAt: genDate,
      reportUrl: String(row[3] || ''),
      shortCode: String(row[4] || ''),
      hasData: !!row[2]
    });
  }
  
  reports.reverse();
  
  return cpJsonResponse_({ success: true, reports: reports });
}

/**
 * 2주 리포트 목록
 */
function cpGetBiweeklyList_(e) {
  var studentName = (e.parameter.student || '').trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CP_SHEET_CONSULT_LOG);
  
  if (!sheet) {
    return cpJsonResponse_({ success: false, error: '상담로그 시트를 찾을 수 없습니다.' });
  }
  
  var data = sheet.getDataRange().getValues();
  var reports = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (studentName && String(row[1]).trim() !== studentName) continue;
    
    var consultDate = row[2];
    if (consultDate instanceof Date) {
      consultDate = Utilities.formatDate(consultDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    
    reports.push({
      consultId: String(row[0]),
      student: String(row[1]).trim(),
      consultDate: consultDate,
      counselor: String(row[3]),
      reportUrl: String(row[9] || ''),  // J열
      shortCode: String(row[10] || ''), // K열
      hasAnalysis: !!row[6]
    });
  }
  
  reports.reverse();
  
  return cpJsonResponse_({ success: true, reports: reports });
}

// ─── 상담 세션 API ───────────────────────────────────────────

/**
 * 상담 브리핑 데이터 조회 (기존 함수 래핑)
 */
function cpGetBriefingData_(e) {
  var studentName = (e.parameter.student || '').trim();
  
  if (!studentName) {
    return cpJsonResponse_({ success: false, error: '학생명이 필요합니다.' });
  }
  
  try {
    if (typeof getSessionBriefingData === 'function') {
      var data = getSessionBriefingData(studentName);
      return cpJsonResponse_({ success: true, data: data });
    } else {
      return cpJsonResponse_({ success: false, error: 'getSessionBriefingData 함수를 찾을 수 없습니다.' });
    }
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

/**
 * 상담 세션 저장 (POST) — 기존 saveSessionToQueue 래핑
 */
function cpSaveSession_(body) {
  try {
    var sessionData = body.data || body;
    
    if (typeof saveSessionToQueue === 'function') {
      saveSessionToQueue(sessionData);
      return cpJsonResponse_({ success: true, message: '상담이 대기열에 저장되었습니다.' });
    } else {
      return cpJsonResponse_({ success: false, error: 'saveSessionToQueue 함수를 찾을 수 없습니다.' });
    }
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

/**
 * 학부모 상담 기록 저장 (POST)
 */
function cpSaveParentConsult_(body) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CP_SHEET_PARENT_LOG);
    
    if (!sheet) {
      return cpJsonResponse_({ success: false, error: '학부모 상담로그 시트를 찾을 수 없습니다.' });
    }
    
    var newRow = [
      body.student || '',
      new Date(),
      body.method || '',   // 상담방법 (전화/대면/온라인)
      body.summary || '',
      body.request || '',  // 요청사항
      body.action || '',   // 조치사항
      body.nextStep || '', // 다음단계
      body.recorder || ''  // 기록자
    ];
    
    sheet.appendRow(newRow);
    
    // 대시보드 반영
    if (typeof updateDashboardParentConsult_ === 'function') {
      updateDashboardParentConsult_(body.student, body.method, body.summary);
    }
    
    return cpJsonResponse_({ success: true, message: '학부모 상담 기록이 저장되었습니다.' });
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

/**
 * 학부모 리포트 생성 (POST) — 기존 generateReport 래핑
 */
function cpGenerateReport_(body) {
  var studentName = (body.student || '').trim();
  
  if (!studentName) {
    return cpJsonResponse_({ success: false, error: '학생명이 필요합니다.' });
  }
  
  try {
    if (typeof generateReport === 'function') {
      var result = generateReport(studentName);
      return cpJsonResponse_({ success: true, result: result });
    } else {
      return cpJsonResponse_({ success: false, error: 'generateReport 함수를 찾을 수 없습니다.' });
    }
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

/**
 * 단축 URL 일괄 생성 (POST)
 */
function cpFillShortCodes_(body) {
  try {
    if (typeof fillShortCodes === 'function') {
      fillShortCodes();
      return cpJsonResponse_({ success: true, message: '단축 URL 일괄 생성 완료' });
    } else {
      return cpJsonResponse_({ success: false, error: 'fillShortCodes 함수를 찾을 수 없습니다.' });
    }
  } catch (err) {
    return cpJsonResponse_({ success: false, error: err.message });
  }
}

// ─── 유틸리티 ────────────────────────────────────────────────

/**
 * JSON 응답 생성
 */
function cpJsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── doGet / doPost 삽입 코드 ────────────────────────────────
// 아래 코드를 ReportGenerator.gs의 doGet()과 doPost()에 삽입하세요.

/*
=== doGet()에 추가할 코드 (go 파라미터 분기 바로 아래) ===

  // ★ 상담 포털 API 분기
  var cpAction = (e.parameter.action || '').trim();
  if (cpAction.indexOf('cp_') === 0) {
    return cpHandleGet_(e);
  }

=== doPost()에 추가할 코드 (맨 앞) ===

  // ★ 상담 포털 API 분기
  try {
    var postBody = JSON.parse(e.postData.contents);
    if (postBody.action && String(postBody.action).indexOf('cp_') === 0) {
      return cpHandlePost_(e);
    }
  } catch (err) {
    // cp_ 접두어가 아니면 기존 로직으로 통과
  }

*/
