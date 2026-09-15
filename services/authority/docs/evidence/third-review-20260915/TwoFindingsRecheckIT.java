package com.qs.authority.review;
import static org.assertj.core.api.Assertions.assertThat;
import com.qs.authority.support.AbstractAuthorityTest;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
/** Independent HTTP and database checks for the two second-review findings. */
public class TwoFindingsRecheckIT extends AbstractAuthorityTest {
 @Test void staleAndCurrentVersionsHaveDistinctErrors() {
  String admin=adminToken(),api="/api/v1/auth/parameters";
  ApiResult p=self(HttpMethod.POST,api,admin,Map.of("paramCode",unique("third"),"paramValue","a")).assertCode(200);
  String route=api+"/"+p.text("id");
  ApiResult changed=self(HttpMethod.PATCH,route,admin,Map.of("version",p.text("version"),"paramValue","b")).assertCode(200);
  self(HttpMethod.PATCH,route,admin,Map.of("version",p.text("version"),"paramValue","b")).assertCode(40901);
  self(HttpMethod.PATCH,route,admin,Map.of("version",p.text("version"),"paramValue","c")).assertCode(40901);
  self(HttpMethod.PATCH,route,admin,Map.of("version",changed.text("version"),"paramValue","b")).assertCode(40001);
  ApiResult finalState=self(HttpMethod.GET,route,admin,null).assertCode(200);
  assertThat(finalState.text("version")).isEqualTo(changed.text("version"));
  assertThat(finalState.text("paramValue")).isEqualTo("b");
 }
 @Test void authorizationAuditRetainsFieldsWithoutCredentials() {
  String token=adminToken(),operation="auth-center.AccountController.list";
  ApiResult r=call(HttpMethod.POST,"/api/v1/auth/authorization-checks",SELF_APP_KEY,token,
   Map.of("operationCode",operation,"resourceId","third-review","resourceType","account"),Map.of("User-Agent","independent-third-review")).assertCode(200);
  String where=" FROM qs__auth__audit_log WHERE trace_id=CAST(? AS uuid)";
  assertThat(queryOne("SELECT count(*)"+where,Long.class,r.traceHeader())).isEqualTo(1L);
  assertThat(queryOne("SELECT request_ip"+where,String.class,r.traceHeader())).isEqualTo("127.0.0.1");
  assertThat(queryOne("SELECT user_agent"+where,String.class,r.traceHeader())).isEqualTo("independent-third-review");
  assertThat(queryOne("SELECT cost_ms"+where,Integer.class,r.traceHeader())).isNotNull().isGreaterThanOrEqualTo(0);
  String request=queryOne("SELECT request_body"+where,String.class,r.traceHeader());
  String response=queryOne("SELECT response_body"+where,String.class,r.traceHeader());
  assertThat(request).contains(operation,"third-review","account").doesNotContain(token,SELF_APP_KEY);
  assertThat(response).contains(operation,"allowed").doesNotContain(token,SELF_APP_KEY);
 }
}
