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

/** Diagnostic probes: passing assertions mean the reported behavior was reproduced, not approved. */
public class ReviewFindingsIT extends AbstractAuthorityTest {
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
        self(HttpMethod.GET,API+"/accounts",member.token(),null).assertCode(200);
        System.out.println("REVIEW R01: invisible member: authorization-check=40301, account list=200");
    }

    @Test void malformedJsonPasswordPersistsInAudit() {
        String marker="SYNTHETIC_REVIEW_PASSWORD_ONLY";
        ApiResult response=call(HttpMethod.POST,API+"/sessions/login",SELF_APP_KEY,null,"{\"username\":\"review\",\"password\":\""+marker+"\",");
        response.assertCode(40001);
        String stored=queryOne("SELECT request_body::text FROM qs__auth__audit_log WHERE trace_id=CAST(? AS uuid)",String.class,response.traceHeader());
        assertThat(stored).contains(marker);
        System.out.println("REVIEW R02: rejected malformed JSON persisted synthetic password plaintext in audit");
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
            assertThat(response.statusCode()).isEqualTo(500);
            assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param WHERE param_code=?",Integer.class,key)).isEqualTo(1);
        }
        System.out.println("REVIEW R03: User-Agent=600 chars: POST=500, parameter committed=1");
    }

    @Test void unchangedPatchIncrementsVersion() {
        String admin=adminToken();
        ApiResult created=self(HttpMethod.POST,API+"/parameters",admin,Map.of("paramCode",unique("review-noop"),"paramValue","same")).assertCode(200);
        ApiResult updated=self(HttpMethod.PATCH,API+"/parameters/"+created.text("id"),admin,Map.of("version",created.text("version"),"paramValue","same")).assertCode(200);
        assertThat(Long.parseLong(updated.text("version"))).isEqualTo(Long.parseLong(created.text("version"))+1);
        System.out.println("REVIEW R04: unchanged PATCH=200 and version increments");
    }

    @Test void unicodePasswordWithinDtoLimitReturns500() {
        String name=unique("review-unicode");
        ApiResult result=self(HttpMethod.POST,API+"/accounts",adminToken(),Map.of("username",name,"password","密".repeat(25)+"A1!"));
        assertThat(result.status()).isEqualTo(500);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account WHERE username=?",Integer.class,name)).isZero();
        System.out.println("REVIEW R05: 28-character/78-byte complex password rejected as HTTP 500");
    }

    @Test void sceneTokenCanUseOrdinaryManagementApi() {
        String admin=adminToken();
        ApiResult scene=self(HttpMethod.POST,API+"/scene-tokens",admin,Map.of("sceneId","review-scene")).assertCode(200);
        self(HttpMethod.GET,API+"/accounts",scene.token(),null).assertCode(200);
        System.out.println("REVIEW R06 observation: scene token accepted by ordinary account management API");
    }

    @Test void detailReaderObtainsApplicationCenterCredential() {
        String admin=adminToken();
        MemberSession member=createMember(admin,"review-reader");
        String op=queryOne("SELECT id::text FROM qs__auth__operation WHERE operation_code=?",String.class,"auth-center.ApplicationAuthorizationController.detail");
        String group=createPermissionGroup(admin,unique("review-detail-group"),List.of(op));
        linkAccountToGroup(admin,group,member.accountId());
        String id=queryOne("SELECT id::text FROM qs__auth__app_authorization WHERE app_code='app-center'",String.class);
        ApiResult detail=self(HttpMethod.GET,API+"/application-authorizations/"+id,member.token(),null).assertCode(200);
        String obtained=detail.text("appKey");
        assertThat(obtained).isEqualTo(APP_CENTER_KEY);
        call(HttpMethod.POST,API+"/application-authorizations",obtained,null,Map.of("appCode",unique("review-escalation"))).assertCode(200);
        System.out.println("REVIEW R07: detail-only member obtained app-center credential and created authorization without user token");
    }

    @Test void invalidIpNetworkAcceptedForServiceAccount() {
        self(HttpMethod.POST,API+"/accounts",adminToken(),Map.of("username",unique("review-service"),"accountType","service","ipWhitelist",List.of("999.999.999.999/99"))).assertCode(200);
        System.out.println("REVIEW R08: invalid IPv4 and prefix accepted in service-account whitelist");
    }
}
