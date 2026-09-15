package com.qs.authority;

import com.qs.authority.config.AuthorityProperties;
import org.apache.ibatis.annotations.Mapper;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 授权中心后端服务入口。
 *
 * <p>服务按[平台公约]统一路径 {@code /api/v1/auth}、统一响应 {@code {code,message,data}}、
 * 北京时间秒精度与 version 编辑规则；身份由 {@code X-App-Key}（应用）与
 * {@code Authorization: Bearer}（账号）共同确定。
 */
@SpringBootApplication
@EnableConfigurationProperties(AuthorityProperties.class)
@EnableScheduling
@MapperScan(basePackages = "com.qs.authority.modules", annotationClass = Mapper.class)
public class AuthorityApplication {

    /**
     * 启动服务。
     *
     * @param args 命令行参数
     */
    public static void main(String[] args) {
        SpringApplication.run(AuthorityApplication.class, args);
    }
}
