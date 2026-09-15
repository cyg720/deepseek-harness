package com.qs.authority.review;

import static org.assertj.core.api.Assertions.assertThat;
import com.qs.authority.support.AbstractAuthorityTest;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.util.ReflectionTestUtils;

/** Independent recheck of original triggers and adjacent regression paths. */
public class IndependentRecheckIT extends AbstractAuthorityTest {
    private static final String API="/api/v1/auth";

    @Test void managementOperationIgnoresApplicationVisibility() {
        String admin=adminToken();
        MemberSession member=createMember(admin,"review-hidden");
        String op=queryOne("SELECT id::text FROM qs__auth__operation WHERE operation_code=?",String.class,"auth-center.AccountController.list");
        String group=createPermissionGroup(admin,unique("review-hidden-group"),List.of(op));
        linkAccountToGroup(admin,group,member.accountId());
        Integer visible=queryOne("SELECT count(*) FROM qs__auth__app_permission_group ap JOIN qs__auth__app_authorization a ON a.id=ap.app_authorization_id WHERE a.app_code='auth-center' AND ap.permission_group_id=?",Integer.class,Long.parseLong(group));
        assertThat(visible).isZero();
        self(HttpMethod.POST,API+"/authorization-checks",member.token(),Map.of("operationCode","auth-center.AccountController.list")).assertCode(40301);
        self(HttpMethod.GET,API+"/accounts",member.token(),null).assertCode(40301);
    }

    @Test void malformedJsonPasswordPersistsInAudit() {
        String marker="SYNTHETIC_REVIEW_PASSWORD_ONLY";
        ApiResult response=call(HttpMethod.POST,API+"/sessions/login",SELF_APP_KEY,null,"{\"username\":\"review\",\"password\":\""+marker+"\",");
        response.assertCode(40001);
        String stored=queryOne("SELECT request_body::text FROM qs__auth__audit_log WHERE trace_id=CAST(? AS uuid)",String.class,response.traceHeader());
        assertThat(stored).doesNotContain(marker).contains("已省略");
    }

    @Test void longUserAgentReturnsFailureAfterCommit() throws Exception {
        String admin=adminToken(), key=unique("review-ua");
        int port=(int)ReflectionTestUtils.getField(this,"port");
        HttpRequest request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+API+"/parameters"))
            .timeout(Duration.ofSeconds(15)).header("Content-Type","application/json")
            .header("X-App-Key",SELF_APP_KEY).header("Authorization","Bearer "+admin)
            .header("User-Agent","r".repeat(600))
            .POST(HttpRequest.BodyPublishers.ofString("{\"paramCode\":\""+key+"\",\"paramValue\":\"review\"}")).build();
        try(HttpClient client=HttpClient.newHttpClient()) {
            HttpResponse<String> response=client.send(request,HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param WHERE param_code=?",Integer.class,key)).isEqualTo(1);
        }
    }

    @Test void unchangedPatchIncrementsVersion() {
        String admin=adminToken();
        ApiResult created=self(HttpMethod.POST,API+"/parameters",admin,Map.of("paramCode",unique("review-noop"),"paramValue","same")).assertCode(200);
        ApiResult updated=self(HttpMethod.PATCH,API+"/parameters/"+created.text("id"),admin,Map.of("version",created.text("version"),"paramValue","same")).assertCode(40001);
        assertThat(queryOne("SELECT version FROM qs__auth__sys_param WHERE id=?",Long.class,Long.parseLong(created.text("id")))).isEqualTo(Long.parseLong(created.text("version")));
    }

    @Test void unicodePasswordWithinDtoLimitReturns500() {
        String name=unique("review-unicode");
        ApiResult result=self(HttpMethod.POST,API+"/accounts",adminToken(),Map.of("username",name,"password","密".repeat(25)+"A1!"));
        result.assertCode(40001);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account WHERE username=?",Integer.class,name)).isZero();
    }

    @Test void sceneTokenCanUseOrdinaryManagementApi() {
        String admin=adminToken();
        ApiResult scene=self(HttpMethod.POST,API+"/scene-tokens",admin,Map.of("sceneId","review-scene")).assertCode(200);
        self(HttpMethod.GET,API+"/accounts",scene.token(),null).assertCode(200);
    }

    @Test void detailReaderObtainsApplicationCenterCredential() {
        String admin=adminToken();
        MemberSession member=createMember(admin,"review-reader");
        String op=queryOne("SELECT id::text FROM qs__auth__operation WHERE operation_code=?",String.class,"auth-center.ApplicationAuthorizationController.detail");
        String group=createPermissionGroup(admin,unique("review-detail-group"),List.of(op));
        linkAccountToGroup(admin,group,member.accountId());
        String selfId=queryOne("SELECT id::text FROM qs__auth__app_authorization WHERE app_code='auth-center'",String.class);
        ApiResult selfDetail=self(HttpMethod.GET,API+"/application-authorizations/"+selfId,admin,null).assertCode(200);
        self(HttpMethod.PATCH,API+"/application-authorizations/"+selfId,admin,Map.of("version",selfDetail.text("version"),"permissionGroupIds",List.of(group))).assertCode(200);
        String id=queryOne("SELECT id::text FROM qs__auth__app_authorization WHERE app_code='app-center'",String.class);
        ApiResult detail=self(HttpMethod.GET,API+"/application-authorizations/"+id,member.token(),null).assertCode(200);
        assertThat(detail.data().has("appKey")).isFalse();
        assertThat(detail.body()).doesNotContain(APP_CENTER_KEY);
        call(HttpMethod.POST,API+"/application-authorizations",SELF_APP_KEY,member.token(),Map.of("appCode",unique("review-escalation"))).assertCode(40301);
    }

    @Test void invalidIpNetworkAcceptedForServiceAccount() {
        self(HttpMethod.POST,API+"/accounts",adminToken(),Map.of("username",unique("review-service"),"accountType","service","ipWhitelist",List.of("999.999.999.999/99"))).assertCode(40001);
    }

    @Test void staleVersionWithSameValueReportsConflict() {
        String admin=adminToken();
        ApiResult p=self(HttpMethod.POST,API+"/parameters",admin,Map.of("paramCode",unique("stale"),"paramValue","a")).assertCode(200);
        self(HttpMethod.PATCH,API+"/parameters/"+p.text("id"),admin,Map.of("version",p.text("version"),"paramValue","b")).assertCode(200);
        self(HttpMethod.PATCH,API+"/parameters/"+p.text("id"),admin,Map.of("version",p.text("version"),"paramValue","b")).assertCode(40901);
    }
    @Test void successfulAuthorizationRetainsRequestAuditFields() {
        ApiResult r=self(HttpMethod.POST,API+"/authorization-checks",adminToken(),Map.of("operationCode","auth-center.AccountController.list")).assertCode(200);
        String ip=queryOne("SELECT request_ip FROM qs__auth__audit_log WHERE trace_id=CAST(? AS uuid)",String.class,r.traceHeader());
        assertThat(ip).as("Successful authorization must retain request IP").isNotBlank();
    }
    @Test void truncatedBodyDoesNotStorePassword() {
        String marker="SYNTHETIC_RECHECK_ONLY";
        ApiResult r=call(HttpMethod.POST,API+"/sessions/login",SELF_APP_KEY,null,"{\"password\":\""+marker+"\",\"padding\":\""+"r".repeat(9000)+"\"}");
        assertThat(r.status()).isBetween(400,499);
        String body=queryOne("SELECT request_body FROM qs__auth__audit_log WHERE trace_id=CAST(? AS uuid)",String.class,r.traceHeader());
        assertThat(body).doesNotContain(marker);
    }
}
